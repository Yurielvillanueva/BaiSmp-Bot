ALTER TABLE servers ADD COLUMN rcon_host TEXT;

UPDATE servers
SET rcon_host = host
WHERE rcon_host IS NULL OR rcon_host = '';
