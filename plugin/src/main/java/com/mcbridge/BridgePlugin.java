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
import java.time.Duration;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;

public final class BridgePlugin extends JavaPlugin implements Listener {
    private HttpServer http;
    private String hmacSecret;
    private String botWebhook;
    private final HttpClient httpClient = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(4)).build();
    private final Map<String, Boolean> seen = new ConcurrentHashMap<>();

    @Override
    public void onEnable() {
        saveDefaultConfig();
        FileConfiguration cfg = getConfig();
        hmacSecret = cfg.getString("hmac-secret", "");
        botWebhook = cfg.getString("bot-webhook", "http://127.0.0.1:3000/plugin/event");
        int port = cfg.getInt("http-port", 8765);
        String bind = cfg.getString("bind", "127.0.0.1");
        try {
            http = HttpServer.create(new InetSocketAddress(bind, port), 0);
            http.createContext("/v1/health", this::health);
            http.createContext("/v1/perf", this::perf);
            http.createContext("/v1/stats/", this::stats);
            http.setExecutor(Executors.newFixedThreadPool(4));
            http.start();
            getLogger().info("MCBridge HTTP on " + bind + ":" + port);
        } catch (IOException e) {
            throw new IllegalStateException("HTTP bind failed", e);
        }
        Bukkit.getPluginManager().registerEvents(this, this);
        Bukkit.getScheduler().runTaskTimer(this, this::tpsWatch, 20L * 30, 20L * 30);
        postEvent("{\"type\":\"server_start\",\"server\":\"" + json(cfg.getString("server-name", "survival")) + "\"}");
    }

    @Override
    public void onDisable() {
        postEvent("{\"type\":\"server_stop\",\"server\":\"" + json(getConfig().getString("server-name", "survival")) + "\"}");
        if (http != null) http.stop(0);
    }

    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (!command.getName().equalsIgnoreCase("link")) return false;
        if (!(sender instanceof Player player)) {
            sender.sendMessage("Players only.");
            return true;
        }
        String code = randomCode();
        String body = "{\"type\":\"link_code\",\"server\":\"" + json(getConfig().getString("server-name", "survival"))
            + "\",\"uuid\":\"" + player.getUniqueId() + "\",\"username\":\"" + json(player.getName())
            + "\",\"code\":\"" + code + "\"}";
        postEvent(body);
        player.sendMessage("Your Discord link code is §a" + code + "§r. It expires in 10 minutes. Run /link code:" + code + " in Discord.");
        return true;
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
        Runtime rt = Runtime.getRuntime();
        int entities = Bukkit.getWorlds().stream().mapToInt(w -> w.getEntities().size()).sum();
        int chunks = Bukkit.getWorlds().stream().mapToInt(w -> w.getLoadedChunks().length).sum();
        String json = "{\"tps\":" + String.format(Locale.US, "%.2f", Bukkit.getTPS()[0])
            + ",\"mspt\":" + String.format(Locale.US, "%.2f", Bukkit.getAverageTickTime())
            + ",\"ramUsed\":" + (rt.totalMemory() - rt.freeMemory())
            + ",\"ramMax\":" + rt.maxMemory()
            + ",\"cpu\":0,\"chunks\":" + chunks + ",\"entities\":" + entities
            + ",\"lagSources\":[]}";
        respond(ex, 200, json);
    }

    private void stats(HttpExchange ex) throws IOException {
        if (!authed(ex, "")) {
            ex.sendResponseHeaders(401, -1);
            ex.close();
            return;
        }
        String path = ex.getRequestURI().getPath().replace("/v1/stats/", "");
        try {
            org.bukkit.OfflinePlayer off = Bukkit.getOfflinePlayer(java.util.UUID.fromString(path));
            Player online = off.getPlayer();
            long play = online == null ? 0 : online.getStatistic(Statistic.PLAY_ONE_MINUTE);
            long deaths = online == null ? 0 : online.getStatistic(Statistic.DEATHS);
            long mob = online == null ? 0 : online.getStatistic(Statistic.MOB_KILLS);
            String json = "{\"stats\":{\"minecraft:custom\":{\"minecraft:play_time\":" + play
                + ",\"minecraft:deaths\":" + deaths + ",\"minecraft:mob_kills\":" + mob + "}}}";
            respond(ex, 200, json);
        } catch (IllegalArgumentException e) {
            respond(ex, 400, "{\"error\":\"invalid uuid\"}");
        }
    }

    private boolean authed(HttpExchange ex, String body) {
        String ts = header(ex, "X-Timestamp");
        String sig = header(ex, "X-Signature");
        if (ts == null || sig == null) return false;
        try {
            long t = Long.parseLong(ts);
            if (Math.abs(System.currentTimeMillis() - t) > 30_000) return false;
            String expect = hmac(hmacSecret, ts + "." + body);
            return expect.equalsIgnoreCase(sig);
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

    private void postEvent(String json) {
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
            httpClient.sendAsync(req, HttpResponse.BodyHandlers.ofString())
                .thenAccept(response -> {
                    if (response.statusCode() >= 400) {
                        getLogger().warning("webhook failed: " + response.statusCode());
                    }
                })
                .exceptionally(e -> {
                    getLogger().warning("webhook exception: " + e.getMessage());
                    return null;
                });
        } catch (Exception e) {
            getLogger().warning("webhook setup failed: " + e.getMessage());
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
