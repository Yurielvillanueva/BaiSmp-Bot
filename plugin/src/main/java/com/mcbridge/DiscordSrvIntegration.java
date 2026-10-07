package com.mcbridge;

import github.scarsz.discordsrv.DiscordSRV;
import github.scarsz.discordsrv.api.events.AccountLinkedEvent;
import github.scarsz.discordsrv.api.events.AccountUnlinkedEvent;
import org.bukkit.OfflinePlayer;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;

import java.util.UUID;

public final class DiscordSrvIntegration implements Listener {
    private final BridgePlugin bridge;

    public DiscordSrvIntegration(BridgePlugin bridge) {
        this.bridge = bridge;
    }

    public void sync(Player player) {
        String discordId = DiscordSRV.getPlugin().getAccountLinkManager().getDiscordId(player.getUniqueId());
        if (discordId != null) {
            bridge.postDiscordSrvLink(player.getUniqueId(), player.getName(), discordId);
        }
    }

    @EventHandler
    public void onAccountLinked(AccountLinkedEvent event) {
        OfflinePlayer player = event.getPlayer();
        UUID uuid = player.getUniqueId();
        String username = player.getName() == null ? uuid.toString() : player.getName();
        bridge.postDiscordSrvLink(uuid, username, event.getUser().getId());
    }

    @EventHandler
    public void onAccountUnlinked(AccountUnlinkedEvent event) {
        OfflinePlayer player = event.getPlayer();
        UUID uuid = player.getUniqueId();
        String username = player.getName() == null ? uuid.toString() : player.getName();
        bridge.postDiscordSrvUnlink(uuid, username, event.getDiscordId());
    }
}
