<?php
declare(strict_types=1);

// Isolated controller contract tests. No Nextcloud bootstrap, credentials or I/O.
namespace OCP {
    interface IConfig { public function getAppValue(string $app, string $key, string $default = ''): string; }
    interface IRequest { public function getHeader(string $name): string; }
    interface IURLGenerator { public function linkToRouteAbsolute(string $route, array $args = []): string; }
    interface IUserSession { public function isLoggedIn(): bool; }
    interface ISession {
        public function get(string $key): mixed;
        public function set(string $key, mixed $value): void;
        public function remove(string $key): void;
    }
    class Util { public static function addScript(string $app, string $script): void {} }
}
namespace OCP\AppFramework {
    class Controller { public function __construct(string $app, protected \OCP\IRequest $request) {} }
}
namespace OCP\AppFramework\Http {
    class JSONResponse { public function __construct(public array $data, public int $status = 200) {} }
    class RedirectResponse { public function __construct(public string $url, public int $status = 302) {} }
    class StandaloneTemplateResponse {
        public function __construct(public string $app, public string $template, public array $data, public string $renderAs) {}
    }
}
namespace OC\Core\Controller {
    class ClientFlowLoginV2Controller {
        public const TOKEN_NAME = 'client-token';
        public const STATE_NAME = 'client-state';
    }
}
namespace OC\Core\Exception {
    class LoginFlowV2NotFoundException extends \Exception {}
    class LoginFlowV2ClientForbiddenException extends \Exception {}
}
namespace OC\Core\Service {
    class LoginFlowV2Service {
        public array $records = [];
        public array $started = [];
        public bool $canStart = true;
        public function getByLoginToken(string $token): mixed {
            if (!isset($this->records[$token])) throw new \OC\Core\Exception\LoginFlowV2NotFoundException();
            return $this->records[$token];
        }
        public function startLoginFlow(string $token): bool {
            $this->started[] = $token;
            return $this->canStart;
        }
    }
}
namespace {
    use OC\Core\Controller\ClientFlowLoginV2Controller;
    use OC\Core\Service\LoginFlowV2Service;
    use OCA\RetroArcadeLogin\Controller\ConnectController;
    use OCP\AppFramework\Http\JSONResponse;
    use OCP\AppFramework\Http\RedirectResponse;
    use OCP\AppFramework\Http\StandaloneTemplateResponse;

    require __DIR__ . '/../retroarcade_login/lib/Controller/ConnectController.php';

    class Request implements \OCP\IRequest {
        public function __construct(public string $origin) {}
        public function getHeader(string $name): string { return $name === 'Origin' ? $this->origin : ''; }
    }
    class Urls implements \OCP\IURLGenerator {
        public function getAbsoluteURL(string $path): string { return 'https://cloud.example.test' . $path; }
        public function linkToRouteAbsolute(string $route, array $args = []): string {
            return 'https://cloud.example.test/routes/' . $route . ($args ? '?' . http_build_query($args) : '');
        }
    }
    class Config implements \OCP\IConfig {
        public function __construct(public array $values) {}
        public function getAppValue(string $app, string $key, string $default = ''): string { return $this->values[$key] ?? $default; }
    }
    class User implements \OCP\IUserSession {
        public function __construct(public bool $loggedIn = true) {}
        public function isLoggedIn(): bool { return $this->loggedIn; }
    }
    class Session implements \OCP\ISession {
        public array $data = [];
        public function get(string $key): mixed { return $this->data[$key] ?? null; }
        public function set(string $key, mixed $value): void { $this->data[$key] = $value; }
        public function remove(string $key): void { unset($this->data[$key]); }
    }
    class Record {
        public function __construct(public string $client, public int $timestamp, public ?string $password = null) {}
        public function getClientName(): string { return $this->client; }
        public function getTimestamp(): int { return $this->timestamp; }
        public function getAppPassword(): ?string { return $this->password; }
    }
    function fixture(string $origin = 'https://other-client.example.test', string $client = 'Slate WASM', ?array $settings = null): array {
        $request = new Request($origin);
        $user = new User();
        $session = new Session();
        $flows = new LoginFlowV2Service();
        $flows->records['Token123'] = new Record($client, time());
        $config = new Config($settings ?? ['server_url'=>'https://cloud.example.test', 'saml_idp'=>'1', 'legacy_origin'=>'https://arcade.example.test', 'trusted_clients'=>json_encode([
            'https://arcade.example.test'=>['client'=>'CloudRcade cloud saves','name'=>'CloudRcade','callback'=>'https://arcade.example.test/cloud-saves/?resume=1','back'=>'https://arcade.example.test/cloud-saves/'],
            'https://other-client.example.test'=>['client'=>'Slate WASM','name'=>'Slate WASM','callback'=>'https://other-client.example.test/?cloud=resume','back'=>'https://other-client.example.test/'],
        ])]);
        return [new ConnectController($request, $user, new Urls(), $session, $flows, $config), $session, $flows, $user, $config];
    }
    function expect(bool $value, string $message): void {
        if (!$value) throw new \RuntimeException($message);
    }
    function rejected(mixed $response, int $status, string $message): void {
        expect($response instanceof JSONResponse && $response->status === $status, $message);
    }
    function state(Session $session): string { return $session->get('retroarcade.pending')['state']; }

    $flow = 'https://cloud.example.test/login/v2/flow/Token123';
    $passed = 0;
    $cases = [
        'generic domain, subdirectory, configurable SSO and callback guards' => function (): void {
            $origin='https://arcade.example.com';
            $client=['client'=>'webRcade cloud saves','name'=>'My Arcade','callback'=>$origin.'/cloud-saves/?resume=1','back'=>$origin.'/cloud-saves/'];
            $settings=['server_url'=>'https://cloud.example.com/subdir','saml_idp'=>'7','trusted_clients'=>json_encode([$origin=>$client])];
            [$controller,$session,$flows,$user,$config]=fixture($origin,$client['client'],$settings);
            $flow='https://cloud.example.com/subdir/index.php/login/v2/flow/Token123';
            expect($controller->start($flow) instanceof RedirectResponse,'custom domain rejected');
            $user->loggedIn=false;$response=$controller->resume(state($session));
            parse_str(parse_url($response->url,PHP_URL_QUERY),$params);expect($params['idp']==='7','configured IdP ignored');
            $config->values['saml_idp']='';$response=$controller->resume(state($session));
            expect(str_contains($response->url,'core.login.showLoginForm'),'native login fallback missing');
            $user->loggedIn=true;expect($controller->resume(state($session))->data['callback']===$client['callback'],'configured callback ignored');
            $client['callback']='https://evil.invalid/';$config->values['trusted_clients']=json_encode([$origin=>$client]);
            rejected($controller->start($flow),403,'foreign configured callback accepted');
            [$controller]=fixture($origin,'webRcade cloud saves',[]);rejected($controller->start($flow),403,'empty config authorized a client');
        },
        'exact client origins and callback isolation'  => function () use ($flow): void {
            foreach ([
                ['https://arcade.example.test', 'CloudRcade cloud saves', 'CloudRcade', 'https://arcade.example.test/cloud-saves/?resume=1'],
                ['https://other-client.example.test', 'Slate WASM', 'Slate WASM', 'https://other-client.example.test/?cloud=resume'],
            ] as [$origin, $client, $name, $callback]) {
                [$controller, $session, $flows] = fixture($origin, $client);
                $start = $controller->start($flow);
                expect($start instanceof RedirectResponse && $start->status === 303, 'valid start must redirect');
                expect($session->get('retroarcade.pending')['origin'] === $origin, 'must bind origin');
                expect(strlen(state($session)) === 64, 'state must contain 256 random bits');
                $response = $controller->resume(state($session));
                expect($response instanceof StandaloneTemplateResponse, 'must render native grant page');
                expect($response->data['callback'] === $callback && $response->data['name'] === $name, 'profile mismatch');
                expect($session->get(ClientFlowLoginV2Controller::TOKEN_NAME) === 'Token123', 'native token missing');
                expect($session->get(ClientFlowLoginV2Controller::STATE_NAME) === state($session), 'native state missing');
                expect($flows->started === ['Token123'], 'must begin native flow once');
                $controller->resume(state($session));
                expect(count($flows->started) === 1, 'reload must not restart grant');
                $session->remove(ClientFlowLoginV2Controller::TOKEN_NAME);
                $completed = $controller->resume(state($session));
                expect($completed instanceof RedirectResponse && $completed->url === $callback, 'completion callback mismatch');
                expect($session->get('retroarcade.pending') === null, 'completed flow must clear pending state');
            }
        },
        'missing, sibling, malformed and foreign origins are rejected' => function () use ($flow): void {
            foreach (['', 'null', 'http://other-client.example.test', 'https://other-client.example.test/', 'https://other-client.example.test:443',
                'https://untrusted.example.test', 'https://other-client.example.test.evil.invalid', 'https://evil.invalid',
                'https://localhost:5173', 'https://arcade.example.test https://other-client.example.test'] as $origin) {
                [$controller, $session] = fixture($origin);
                rejected($controller->start($flow), 403, 'foreign origin accepted');
                expect($session->data === [], 'rejected origin must not mutate session');
            }
        },
        'each origin requires its own native client name' => function () use ($flow): void {
            foreach ([['https://arcade.example.test', 'Slate WASM'], ['https://other-client.example.test', 'CloudRcade cloud saves'],
                ['https://other-client.example.test', 'Unknown app']] as [$origin, $client]) {
                [$controller, $session] = fixture($origin, $client);
                rejected($controller->start($flow), 400, 'cross-client flow accepted');
                expect($session->data === [], 'rejected client must not mutate session');
            }
        },
        'only exact local native flow URLs are accepted' => function (): void {
            [$controller] = fixture();
            foreach (['https://evil.invalid/login/v2/flow/Token123', 'https://cloud.example.test.evil.invalid/login/v2/flow/Token123',
                'https://cloud.example.test@evil.invalid/login/v2/flow/Token123', 'http://cloud.example.test/login/v2/flow/Token123',
                'https://cloud.example.test/login/v2/flow/Token123?callback=https://evil.invalid',
                "https://cloud.example.test/login/v2/flow/Token123\n", 'https://cloud.example.test/login/v2/flow/../Token123'] as $url) {
                rejected($controller->start($url), 400, 'invalid flow URL accepted');
                rejected($controller->index($url), 400, 'manual flow accepted external URL');
            }
            expect($controller->start('https://cloud.example.test/index.php/login/v2/flow/Token123') instanceof RedirectResponse, 'index.php variant rejected');
        },
        'expired, completed and unknown native flows are rejected' => function () use ($flow): void {
            [$controller, , $flows] = fixture();
            $flows->records['Token123']->timestamp = time() - 1201;
            rejected($controller->start($flow), 400, 'expired native flow accepted');
            $flows->records['Token123']->timestamp = time();
            $flows->records['Token123']->password = 'test-token-not-a-secret';
            rejected($controller->start($flow), 400, 'completed native flow accepted');
            rejected($controller->start('https://cloud.example.test/login/v2/flow/Unknown'), 400, 'unknown native flow accepted');
        },
        'resume state stays bound to its Nextcloud session' => function () use ($flow): void {
            [$controller, $session] = fixture();
            $controller->start($flow);
            rejected($controller->resume('wrong-state'), 400, 'wrong state accepted');
            [$other] = fixture();
            rejected($other->resume(state($session)), 400, 'copied state accepted in different session');
            $pending = $session->get('retroarcade.pending');
            $pending['expires'] = time() - 1;
            $session->set('retroarcade.pending', $pending);
            rejected($controller->resume($pending['state']), 400, 'expired state accepted');
            $session->set('retroarcade.pending', ['expires' => time() + 30]);
            rejected($controller->resume(''), 400, 'malformed state accepted');
        },
        'SAML receives the state-bound resume URL' => function () use ($flow): void {
            [$controller, $session, $flows, $user] = fixture();
            $controller->start($flow);
            $user->loggedIn = false;
            $response = $controller->resume(state($session));
            expect($response instanceof RedirectResponse, 'logged-out user must use SAML');
            parse_str(parse_url($response->url, PHP_URL_QUERY), $params);
            expect($params['idp'] === '1' && str_contains($params['originalUrl'], 'connect.resume?state=' . state($session)), 'SAML lost bound state');
            expect($flows->started === [], 'native flow must wait until authenticated');
        },
        'pre-existing games pending state preserves its destination' => function () use ($flow): void {
            [$controller, $session] = fixture('https://arcade.example.test', 'CloudRcade cloud saves');
            $controller->start($flow);
            $pending = $session->get('retroarcade.pending');
            unset($pending['origin']);
            $session->set('retroarcade.pending', $pending);
            $response = $controller->resume(state($session));
            expect($response->data['callback'] === 'https://arcade.example.test/cloud-saves/?resume=1', 'legacy session callback changed');
        },
        'stored unexpected clients never become redirect destinations' => function () use ($flow): void {
            [$controller, $session] = fixture();
            $controller->start($flow);
            $pending = $session->get('retroarcade.pending');
            $pending['origin'] = 'https://evil.invalid';
            $pending['callback'] = 'https://evil.invalid';
            $session->set('retroarcade.pending', $pending);
            rejected($controller->resume(state($session)), 400, 'unexpected pending client accepted');
        },
        'native flow expiry is respected during resume' => function () use ($flow): void {
            [$controller, $session, $flows] = fixture();
            $controller->start($flow);
            $flows->canStart = false;
            rejected($controller->resume(state($session)), 400, 'expired flow resumed');
            expect($session->get(ClientFlowLoginV2Controller::TOKEN_NAME) === null, 'failed flow prepared native grant');
        },
        'manual SSO fallback retains original native approval behavior' => function () use ($flow): void {
            [$controller, , , $user] = fixture();
            expect($controller->index($flow)->url === $flow, 'existing session manual flow changed');
            $user->loggedIn = false;
            $response = $controller->index($flow);
            parse_str(parse_url($response->url, PHP_URL_QUERY), $params);
            expect($params['originalUrl'] === $flow && $params['idp'] === '1', 'manual SAML flow changed');
        },
    ];
    foreach ($cases as $name => $test) {
        $test();
        ++$passed;
        echo "PASS $name\n";
    }
    echo "$passed controller cases passed\n";
}
