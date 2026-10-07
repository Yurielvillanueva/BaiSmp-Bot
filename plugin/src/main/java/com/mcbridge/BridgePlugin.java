package com.mcbridge;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import org.bukkit.Bukkit;
import org.bukkit.Statistic;
import org.bukkit.command.Command;
import org.bukkit.command.CommandSender;
import org.bukkit.configuration.file.FileConfiguration;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.PlayerDeathEvent;
import org.bukkit.event.player.AsyncPlayerChatEvent;
import org.bukkit.event.player.PlayerAdvancementDoneEvent;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.plugin.Plugin;
import org.bukkit.plugin.java.JavaPlugin;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.time.Duration;
import java.util.Locale;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

public final class BridgePlugin extends JavaPlugin implements Listener {
    private HttpServer http;
    private ExecutorService httpExecutor;
    private String hmacSecret;
    private String botWebhook;
    private Object discordSrvIntegration;
    private Method discordSrvSyncMethod;
    private final HttpClient httpClient = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(4)).build();

    @Override
    public void onEnable() {
        saveDefaultConfig();
        FileConfiguration cfg = getConfig();
        hmacSecret = cfg.getString("hmac-secret", "");
        if (hmacSecret == null || hmacSecret.length() < 16) {
            throw new IllegalStateException("Configure a shared HMAC secret of at least 16 characters.");
        }
        botWebhook = validateBotWebhook(cfg.getString("bot-webhook", "http://127.0.0.1:3001/plugin/event"));
        getLogger().info("Signed bot webhook configured for " + URI.create(botWebhook).getHost());
        int port = cfg.getInt("http-port", 8765);
        String bind = cfg.getString("bind", "127.0.0.1");
        try {
            http = HttpServer.create(new InetSocketAddress(bind, port), 0);
            http.createContext("/v1/health", this::health);
            http.createContext("/v1/perf", this::perf);
            http.createContext("/v1/stats/", this::stats);
            httpExecutor = Executors.newFixedThreadPool(4);
            http.setExecutor(httpExecutor);
            http.start();
            getLogger().info("MCBridge HTTP on " + bind + ":" + port);
        } catch (IOException e) {
            throw new IllegalStateException("HTTP bind failed", e);
        }
        Bukkit.getPluginManager().registerEvents(this, this);
        enableDiscordSrvIntegration();
        Bukkit.getScheduler().runTaskTimer(this, this::tpsWatch, 20L * 30, 20L * 30);
        postEvent("{\"type\":\"server_start\",\"server\":\"" + json(cfg.getString("server-name", "survival")) + "\"}");
    }

    @Override
    public void onDisable() {
        postEvent("{\"type\":\"server_stop\",\"server\":\"" + json(getConfig().getString("server-name", "survival")) + "\"}");
        if (http != null) http.stop(0);
        if (httpExecutor != null) httpExecutor.shutdownNow();
    }

    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (!command.getName().equalsIgnoreCase("discordlink")) return false;
        if (!(sender instanceof Player player)) {
            sender.sendMessage("Players only.");
            return true;
        }
        String code = randomCode();
        String body = "{\"type\":\"link_code\",\"server\":\"" + json(getConfig().getString("server-name", "survival"))
            + "\",\"uuid\":\"" + player.getUniqueId() + "\",\"username\":\"" + json(player.getName())
            + "\",\"code\":\"" + code + "\"}";
        postEvent(body).thenAccept(delivered -> Bukkit.getScheduler().runTask(this, () -> {
            if (!player.isOnline()) return;
            if (delivered) {
                player.sendMessage("Your Discord link code is §a" + code + "§r. It expires in 10 minutes. In Discord, run /link and enter this code.");
            } else {
                player.sendMessage("Could not reach the Discord bot. Ask an administrator to check the MCBridge bot-webhook URL and shared secret.");
            }
        }));
        return true;
    }

    private static String validateBotWebhook(String configured) {
        final URI uri;
        try {
            uri = URI.create(configured);
        } catch (IllegalArgumentException e) {
            throw new IllegalStateException("bot-webhook must be a valid URL ending in /plugin/event.", e);
        }
        String scheme = uri.getScheme();
        String host = uri.getHost();
        if (!uri.isAbsolute() || host == null || uri.getUserInfo() != null
            || !"/plugin/event".equals(uri.getPath()) || uri.getQuery() != null || uri.getFragment() != null
            || !("http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme))) {
            throw new IllegalStateException("bot-webhook must be an HTTP(S) URL ending in /plugin/event with no credentials or extra path/query.");
        }
        boolean loopbackHost = "localhost".equalsIgnoreCase(host)
            || "127.0.0.1".equals(host)
            || "::1".equals(host)
            || "[::1]".equalsIgnoreCase(host);
        if ("http".equalsIgnoreCase(scheme) && !loopbackHost) {
            throw new IllegalStateException("Remote bot-webhook URLs must use HTTPS; plain HTTP is allowed only for loopback.");
        }
        return uri.toASCIIString();
    }

    @EventHandler
    public void onJoin(PlayerJoinEvent event) {
        Player p = event.getPlayer();
        boolean first = !p.hasPlayedBefore();
        String hashed = hashIp(p.getAddress() == null ? "" : p.getAddress().getAddress().getHostAddress());
        String type = first ? "first_join" : "join";
        postEvent("{\"type\":\"" + type + "\",\"server\":\"" + json(getConfig().getString("server-name", "survival"))
            + "\",\"uuid\":\"" + p.getUniqueId() + "\",\"username\":\"" + json(p.getName())
            + "\",\"hashedIp\":\"" + hashed + "\"}");
        syncDiscordSrvLink(p);
    }

    private void syncDiscordSrvLink(Player player) {
        if (discordSrvIntegration == null || discordSrvSyncMethod == null) return;
        try {
            discordSrvSyncMethod.invoke(discordSrvIntegration, player);
        } catch (IllegalAccessException | InvocationTargetException e) {
            Throwable cause = e instanceof InvocationTargetException && e.getCause() != null ? e.getCause() : e;
            getLogger().warning("Could not synchronize DiscordSRV account link: " + cause.getMessage());
        }
    }

    private void enableDiscordSrvIntegration() {
        Plugin discordSrvPlugin = Bukkit.getPluginManager().getPlugin("DiscordSRV");
        if (discordSrvPlugin == null || !discordSrvPlugin.isEnabled()) return;
        try {
            Class<?> integrationClass = Class.forName("com.mcbridge.DiscordSrvIntegration", true, getClass().getClassLoader());
            Object integration = integrationClass.getConstructor(BridgePlugin.class).newInstance(this);
            if (!(integration instanceof Listener listener)) {
                throw new IllegalStateException("DiscordSRV integration is not a Bukkit listener.");
            }
            discordSrvSyncMethod = integrationClass.getMethod("sync", Player.class);
            discordSrvIntegration = integration;
            Bukkit.getPluginManager().registerEvents(listener, this);
            getLogger().info("DiscordSRV account-link synchronization enabled.");
        } catch (ReflectiveOperationException e) {
            throw new IllegalStateException("DiscordSRV is enabled but MCBridge could not initialize its account-link integration.", e);
        }
    }

    void postDiscordSrvLink(UUID uuid, String username, String discordId) {
        postEvent("{\"type\":\"discordsrv_linked\",\"server\":\"" + json(getConfig().getString("server-name", "survival"))
            + "\",\"uuid\":\"" + uuid + "\",\"username\":\"" + json(username)
            + "\",\"discordId\":\"" + json(discordId) + "\"}");
    }

    void postDiscordSrvUnlink(UUID uuid, String username, String discordId) {
        postEvent("{\"type\":\"discordsrv_unlinked\",\"server\":\"" + json(getConfig().getString("server-name", "survival"))
            + "\",\"uuid\":\"" + uuid + "\",\"username\":\"" + json(username)
            + "\",\"discordId\":\"" + json(discordId) + "\"}");
    }

    @EventHandler
    public void onQuit(PlayerQuitEvent event) {
        Player p = event.getPlayer();
        postEvent("{\"type\":\"leave\",\"server\":\"" + json(getConfig().getString("server-name", "survival"))
            + "\",\"uuid\":\"" + p.getUniqueId() + "\",\"username\":\"" + json(p.getName()) + "\"}");
    }

    @EventHandler
    public void onDeath(PlayerDeathEvent event) {
        Player p = event.getEntity();
        postEvent("{\"type\":\"death\",\"server\":\"" + json(getConfig().getString("server-name", "survival"))
            + "\",\"uuid\":\"" + p.getUniqueId() + "\",\"username\":\"" + json(p.getName())
            + "\",\"message\":\"" + json(String.valueOf(event.getDeathMessage())) + "\"}");
    }

    @EventHandler
    public void onAdv(PlayerAdvancementDoneEvent event) {
        if (event.getAdvancement().getKey().getKey().contains("recipe/")) return;
        Player p = event.getPlayer();
        postEvent("{\"type\":\"advancement\",\"server\":\"" + json(getConfig().getString("server-name", "survival"))
            + "\",\"uuid\":\"" + p.getUniqueId() + "\",\"username\":\"" + json(p.getName())
            + "\",\"advancement\":\"" + json(event.getAdvancement().getKey().toString()) + "\"}");
    }

    @EventHandler
    public void onChat(AsyncPlayerChatEvent event) {
        Player p = event.getPlayer();
        postEvent("{\"type\":\"chat\",\"server\":\"" + json(getConfig().getString("server-name", "survival"))
            + "\",\"uuid\":\"" + p.getUniqueId() + "\",\"username\":\"" + json(p.getName())
            + "\",\"message\":\"" + json(event.getMessage()) + "\"}");
    }

    private void tpsWatch() {
        double tps = Math.min(20.0, Bukkit.getTPS()[0]);
        double threshold = getConfig().getDouble("tps-threshold", 16.0);
        if (tps < threshold) {
            postEvent("{\"type\":\"tps\",\"server\":\"" + json(getConfig().getString("server-name", "survival"))
                + "\",\"tps\":" + String.format(Locale.US, "%.2f", tps) + "}");
        }
    }

    private void health(HttpExchange ex) throws IOException {
        if (!authed(ex, "")) {
            ex.sendResponseHeaders(401, -1);
            ex.close();
            return;
        }
        respond(ex, 200, "{\"ok\":true}");
    }

    private void perf(HttpExchange ex) throws IOException {
        if (!authed(ex, "")) {
            ex.sendResponseHeaders(401, -1);
            ex.close();
            return;
        }
        try {
            String response = callOnMain(() -> {
                Runtime rt = Runtime.getRuntime();
                int entities = Bukkit.getWorlds().stream().mapToInt(w -> w.getEntities().size()).sum();
                int chunks = Bukkit.getWorlds().stream().mapToInt(w -> w.getLoadedChunks().length).sum();
                return "{\"tps\":" + String.format(Locale.US, "%.2f", Bukkit.getTPS()[0])
                    + ",\"mspt\":" + String.format(Locale.US, "%.2f", Bukkit.getAverageTickTime())
                    + ",\"ramUsed\":" + (rt.totalMemory() - rt.freeMemory())
                    + ",\"ramMax\":" + rt.maxMemory()
                    + ",\"cpu\":0,\"chunks\":" + chunks + ",\"entities\":" + entities
                    + ",\"lagSources\":[]}";
            });
            respond(ex, 200, response);
        } catch (Exception e) {
            getLogger().warning("Performance request failed: " + e.getMessage());
            respond(ex, 503, "{\"error\":\"server data unavailable\"}");
        }
    }

    private void stats(HttpExchange ex) throws IOException {
        if (!authed(ex, "")) {
            ex.sendResponseHeaders(401, -1);
            ex.close();
            return;
        }
        String path = ex.getRequestURI().getPath().replace("/v1/stats/", "");
        try {
            java.util.UUID uuid = java.util.UUID.fromString(path);
            String response = callOnMain(() -> {
                org.bukkit.OfflinePlayer off = Bukkit.getOfflinePlayer(uuid);
                long play = off.getStatistic(Statistic.PLAY_ONE_MINUTE);
                long deaths = off.getStatistic(Statistic.DEATHS);
                long mob = off.getStatistic(Statistic.MOB_KILLS);
                return "{\"stats\":{\"minecraft:custom\":{\"minecraft:play_time\":" + play
                    + ",\"minecraft:deaths\":" + deaths + ",\"minecraft:mob_kills\":" + mob + "}}}";
            });
            respond(ex, 200, response);
        } catch (IllegalArgumentException e) {
            respond(ex, 400, "{\"error\":\"invalid uuid\"}");
        } catch (Exception e) {
            getLogger().warning("Player stats request failed: " + e.getMessage());
            respond(ex, 503, "{\"error\":\"player data unavailable\"}");
        }
    }

    private <T> T callOnMain(java.util.concurrent.Callable<T> task) throws Exception {
        if (Bukkit.isPrimaryThread()) return task.call();
        return Bukkit.getScheduler().callSyncMethod(this, task).get(2, TimeUnit.SECONDS);
    }

    private boolean authed(HttpExchange ex, String body) {
        String ts = header(ex, "X-Timestamp");
        String sig = header(ex, "X-Signature");
        if (ts == null || sig == null) return false;
        try {
            long t = Long.parseLong(ts);
            if (Math.abs(System.currentTimeMillis() - t) > 30_000) return false;
            String expect = hmac(hmacSecret, ts + "." + body);
            return MessageDigest.isEqual(
                expect.getBytes(StandardCharsets.US_ASCII),
                sig.toLowerCase(Locale.ROOT).getBytes(StandardCharsets.US_ASCII)
            );
        } catch (Exception e) {
            return false;
        }
    }

    private static String header(HttpExchange ex, String name) {
        return ex.getRequestHeaders().getFirst(name);
    }

    private static void respond(HttpExchange ex, int code, String body) throws IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        ex.getResponseHeaders().add("Content-Type", "application/json");
        ex.sendResponseHeaders(code, bytes.length);
        try (OutputStream os = ex.getResponseBody()) {
            os.write(bytes);
        }
    }

    private CompletableFuture<Boolean> postEvent(String json) {
        try {
            String ts = String.valueOf(System.currentTimeMillis());
            String sig = hmac(hmacSecret, ts + "." + json);
            HttpRequest req = HttpRequest.newBuilder(URI.create(botWebhook))
                .timeout(Duration.ofSeconds(4))
                .header("Content-Type", "application/json")
                .header("X-Timestamp", ts)
                .header("X-Signature", sig)
                .POST(HttpRequest.BodyPublishers.ofString(json))
                .build();
            return httpClient.sendAsync(req, HttpResponse.BodyHandlers.ofString())
                .thenApply(response -> {
                    boolean delivered = response.statusCode() >= 200 && response.statusCode() < 300;
                    if (!delivered) {
                        getLogger().warning("webhook failed: " + response.statusCode());
                    }
                    return delivered;
                })
                .exceptionally(e -> {
                    getLogger().warning("webhook exception: " + e.getMessage());
                    return false;
                });
        } catch (Exception e) {
            getLogger().warning("webhook setup failed: " + e.getMessage());
            return CompletableFuture.completedFuture(false);
        }
    }

    private static String hmac(String secret, String payload) throws Exception {
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
        byte[] raw = mac.doFinal(payload.getBytes(StandardCharsets.UTF_8));
        StringBuilder sb = new StringBuilder();
        for (byte b : raw) sb.append(String.format("%02x", b));
        return sb.toString();
    }

    private String hashIp(String ip) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] raw = md.digest((hmacSecret + ":" + ip).getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder();
            for (byte b : raw) sb.append(String.format("%02x", b));
            return sb.toString();
        } catch (Exception e) {
            return "";
        }
    }

    private static String json(String s) {
        if (s == null) return "";
        return s.replace("\\", "\\\\")
                .replace("\"", "\\\"")
                .replace("\n", "\\n")
                .replace("\r", "\\r")
                .replace("\t", "\\t");
    }

    private static String randomCode() {
        String alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        StringBuilder sb = new StringBuilder();
        java.security.SecureRandom r = new java.security.SecureRandom();
        for (int i = 0; i < 6; i++) sb.append(alphabet.charAt(r.nextInt(alphabet.length())));
        return sb.toString();
    }
}
