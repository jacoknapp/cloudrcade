<?php
declare(strict_types=1);
namespace OCA\RetroArcadeLogin\Controller;

use OC\Core\Controller\ClientFlowLoginV2Controller;
use OC\Core\Service\LoginFlowV2Service;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http\Attribute\NoCSRFRequired;
use OCP\AppFramework\Http\Attribute\PublicPage;
use OCP\AppFramework\Http\Attribute\UseSession;
use OCP\AppFramework\Http\JSONResponse;
use OCP\AppFramework\Http\RedirectResponse;
use OCP\IRequest;
use OCP\IURLGenerator;
use OCP\IUserSession;
use OCP\ISession;
use OCP\AppFramework\Http\StandaloneTemplateResponse;
use OCP\Util;

class ConnectController extends Controller {
    // Callback destinations are owned by the server, never accepted from a
    // request. The initiating origin must also match the native flow's client.
    public function __construct(IRequest $request, private IUserSession $userSession, private IURLGenerator $urlGenerator, private ISession $session, private LoginFlowV2Service $flows, private \OCP\IConfig $config) {
        parent::__construct('retroarcade_login', $request);
    }

    private function setting(string $env, string $key): string {
        $value = getenv($env);
        return $value === false ? $this->config->getAppValue('retroarcade_login', $key, '') : $value;
    }

    private function clients(): array {
        $configured = json_decode($this->setting('RETROARCADE_TRUSTED_CLIENTS', 'trusted_clients'), true);
        $clients = [];
        foreach (is_array($configured) ? $configured : [] as $origin => $client) {
            $parts = parse_url((string)$origin);
            if (!$parts || !filter_var($origin, FILTER_VALIDATE_URL) || ($parts['scheme'] ?? '') !== 'https' ||
                isset($parts['user']) || isset($parts['query']) || isset($parts['fragment']) || !empty($parts['path']) || !is_array($client)) continue;
            if (empty($client['client']) || !is_string($client['client']) || strlen($client['client']) > 256) continue;
            foreach (['callback', 'back'] as $key) {
                $url = $client[$key] ?? '';
                $p = is_string($url) ? parse_url($url) : false;
                if (!$p || !filter_var($url, FILTER_VALIDATE_URL) || isset($p['user']) || isset($p['fragment']) ||
                    (($p['scheme'] ?? '') . '://' . ($p['host'] ?? '') . (isset($p['port']) ? ':' . $p['port'] : '')) !== $origin) continue 2;
            }
            $client['name'] = is_string($client['name'] ?? null) ? $client['name'] : $client['client'];
            $clients[$origin] = $client;
        }
        return $clients;
    }

    private function flowToken(string $flow): ?string {
        $server = $this->setting('RETROARCADE_SERVER_URL', 'server_url');
        if ($server === '') $server = $this->urlGenerator->getAbsoluteURL('/');
        $server = rtrim($server, '/');
        $parts = parse_url($server);
        if (!$parts || !filter_var($server, FILTER_VALIDATE_URL) || ($parts['scheme'] ?? '') !== 'https' ||
            isset($parts['user']) || isset($parts['query']) || isset($parts['fragment'])) return null;
        return preg_match('~^' . preg_quote($server, '~') . '/(?:index\\.php/)?login/v2/flow/([A-Za-z0-9]+)$~D', $flow, $match) ? $match[1] : null;
    }

    private function signIn(string $return): RedirectResponse {
        $idp = $this->setting('RETROARCADE_SAML_IDP', 'saml_idp');
        if (ctype_digit($idp) && (int)$idp > 0) return new RedirectResponse($this->urlGenerator->linkToRouteAbsolute('user_saml.SAML.login', [
            'idp' => (int)$idp, 'originalUrl' => $return,
        ]));
        return new RedirectResponse($this->urlGenerator->linkToRouteAbsolute('core.login.showLoginForm', ['redirect_url' => $return]));
    }

    #[PublicPage]
    #[NoCSRFRequired]
    #[UseSession]
    public function index(string $flow = ''): RedirectResponse|JSONResponse {
        // This handoff accepts only this server's Login Flow v2 URLs.
        if ($this->flowToken($flow) === null) {
            return new JSONResponse(['error' => 'Invalid login flow'], 400);
        }
        if ($this->userSession->isLoggedIn()) return new RedirectResponse($flow);
        return $this->signIn($flow);
    }

    // Cross-origin POST is intentional; only explicitly configured origins
    // may initiate automatic consent. A copied GET link never grants access.
    #[PublicPage]
    #[NoCSRFRequired]
    #[UseSession]
    public function start(string $flow = ''): RedirectResponse|JSONResponse {
        $origin = $this->request->getHeader('Origin');
        $client = $this->clients()[$origin] ?? null;
        if ($client === null) {
            return new JSONResponse(['error' => 'Origin rejected'], 403);
        }
        if (($token = $this->flowToken($flow)) === null) {
            return new JSONResponse(['error' => 'Invalid login flow'], 400);
        }
        try {
            $record = $this->flows->getByLoginToken($token);
            if ($record->getClientName() !== $client['client'] || $record->getTimestamp() < time() - 1200 || $record->getAppPassword() !== null) {
                return new JSONResponse(['error' => 'Invalid or expired login flow'], 400);
            }
        } catch (\OC\Core\Exception\LoginFlowV2NotFoundException | \OC\Core\Exception\LoginFlowV2ClientForbiddenException $e) {
            return new JSONResponse(['error' => 'Invalid login flow'], 400);
        }
        $state = bin2hex(random_bytes(32));
        $this->session->set('retroarcade.pending', ['token' => $token, 'state' => $state, 'origin' => $origin, 'expires' => time() + 1200, 'prepared' => false]);
        return new RedirectResponse($this->urlGenerator->linkToRouteAbsolute('retroarcade_login.connect.resume', ['state' => $state]), 303);
    }

    #[PublicPage]
    #[NoCSRFRequired]
    #[UseSession]
    public function resume(string $state = ''): RedirectResponse|JSONResponse|StandaloneTemplateResponse {
        $pending = $this->session->get('retroarcade.pending');
        if (!is_array($pending) || ($pending['expires'] ?? 0) < time() || !is_string($pending['state'] ?? null) || !hash_equals($pending['state'], $state)) {
            return new JSONResponse(['error' => 'Connection expired. Return to the app and connect again.'], 400);
        }
        $client = $this->clients()[$pending['origin'] ?? $this->setting('RETROARCADE_LEGACY_ORIGIN', 'legacy_origin')] ?? null;
        if ($client === null) {
            return new JSONResponse(['error' => 'Invalid connection client'], 400);
        }
        if (!$this->userSession->isLoggedIn()) {
            return $this->signIn($this->urlGenerator->linkToRouteAbsolute('retroarcade_login.connect.resume', ['state' => $state]));
        }
        if (!$pending['prepared']) {
            if (!$this->flows->startLoginFlow($pending['token'])) return new JSONResponse(['error' => 'Login flow expired'], 400);
            $this->session->set(ClientFlowLoginV2Controller::TOKEN_NAME, $pending['token']);
            $this->session->set(ClientFlowLoginV2Controller::STATE_NAME, $state);
            $pending['prepared'] = true;
            $this->session->set('retroarcade.pending', $pending);
        } elseif ($this->session->get(ClientFlowLoginV2Controller::TOKEN_NAME) !== $pending['token']) {
            // Native completion clears its session keys. Do not mint twice on reload.
            $this->session->remove('retroarcade.pending');
            return new RedirectResponse($client['callback']);
        }
        Util::addScript('retroarcade_login', 'connect');
        return new StandaloneTemplateResponse('retroarcade_login', 'connect', [
            'state' => $state,
            'grant' => $this->urlGenerator->linkToRouteAbsolute('core.ClientFlowLoginV2.generateAppPassword'),
            'confirm' => $this->urlGenerator->linkToRouteAbsolute('core.login.confirmPassword'),
            'manual' => $this->urlGenerator->linkToRouteAbsolute('core.ClientFlowLoginV2.grantPage', ['stateToken' => $state]),
            'name' => $client['name'],
            'callback' => $client['callback'],
            'back' => $client['back'],
        ], 'guest');
    }

}
