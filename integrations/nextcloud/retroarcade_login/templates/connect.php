<?php declare(strict_types=1); ?>
<div id="retroarcade-connect" data-state="<?php p($_['state']); ?>" data-grant="<?php p($_['grant']); ?>" data-confirm="<?php p($_['confirm']); ?>" data-callback="<?php p($_['callback']); ?>">
    <h2>Connect <?php p($_['name']); ?></h2>
    <p id="retroarcade-status" role="status">Connecting your Nextcloud account…</p>
    <form id="retroarcade-confirm" hidden>
        <label for="retroarcade-password">Confirm your Nextcloud password</label>
        <input id="retroarcade-password" type="password" autocomplete="current-password" required>
        <button type="submit">Continue</button>
    </form>
    <p><a href="<?php p($_['manual']); ?>">Continue manually</a></p>
    <p><a href="<?php p($_['back']); ?>">Back to <?php p($_['name']); ?></a></p>
</div>
