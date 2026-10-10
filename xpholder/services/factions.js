const { sqlLite3DatabaseService } = require('../database/sqlite');
const path = require('node:path');

// Queue writers before opening connections: blocked SQLite workers can otherwise
// fill Node's worker pool while the active transaction waits to finish its queries.
const writers = new Map();

function factionDetails(details) {
    const name = details.name?.trim();
    const description = details.description?.trim();
    const imageUrl = details.image_url?.trim() || '';
    if (!name || name.length > 80) { throw new Error('Faction names must contain 1–80 characters.'); }
    if (!description || description.length > 2000) { throw new Error('Faction descriptions must contain 1–2000 characters.'); }
    if (imageUrl) {
        let url;
        try { url = new URL(imageUrl); } catch { throw new Error('The faction image must be a valid HTTPS URL.'); }
        if (url.protocol !== 'https:' || imageUrl.length > 2048) { throw new Error('The faction image must be an HTTPS URL of at most 2048 characters.'); }
    }
    return { name, name_key: name.normalize('NFKC').toLowerCase(), description, image_url: imageUrl };
}

class factionService {
    constructor(database) { this.database = database; }

    async connect(action, transaction = false) {
        if (!transaction) { return this.withConnection(action, false); }
        const databasePath = path.resolve(this.database.databaseName);
        const key = process.platform === 'win32' ? databasePath.toLowerCase() : databasePath;
        const pending = (writers.get(key) || Promise.resolve()).catch(() => {})
            .then(() => this.withConnection(action, true));
        writers.set(key, pending);
        try { return await pending; }
        finally { if (writers.get(key) === pending) { writers.delete(key); } }
    }

    async withConnection(action, transaction) {
        // Each interaction/collector gets its own connection; no shared handle races.
        const db = new sqlLite3DatabaseService(this.database.sqlite3, this.database.databaseName);
        if (!await db.openDatabase()) { throw new Error('Could not open the faction database.'); }
        db.database.configure('busyTimeout', 5000);
        const run = async (sql, params = []) => {
            if (!await db.execute(sql, params)) { throw new Error('Could not save faction data.'); }
        };
        let started = false;
        try {
            if (transaction) { await run('BEGIN IMMEDIATE;'); started = true; }
            const result = await action(db, run);
            if (transaction) { await run('COMMIT;'); }
            return result;
        } catch (error) {
            if (started) { await db.execute('ROLLBACK;'); }
            throw error;
        } finally {
            await db.closeDatabase();
        }
    }

    async init() {
        await this.connect(async (db, run) => {
            await run(`CREATE TABLE IF NOT EXISTS factions (
                faction_id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL, name_key TEXT NOT NULL UNIQUE,
                description TEXT NOT NULL, image_url TEXT NOT NULL DEFAULT ''
            );`);
            await run(`CREATE TABLE IF NOT EXISTS character_faction_renown (
                character_id TEXT NOT NULL, faction_id INTEGER NOT NULL,
                renown INTEGER NOT NULL DEFAULT 0,
                quests INTEGER NOT NULL DEFAULT 0 CHECK (quests >= 0),
                solo_challenges INTEGER NOT NULL DEFAULT 0 CHECK (solo_challenges >= 0),
                PRIMARY KEY (character_id, faction_id)
            );`);
            // Also applies to legacy deletion paths and direct character deletion.
            await run(`CREATE TRIGGER IF NOT EXISTS delete_character_faction_renown
                AFTER DELETE ON characters BEGIN
                    DELETE FROM character_faction_renown WHERE character_id = OLD.character_id;
                END;`);
        }, true);
    }

    async list(characterId = null) {
        return this.connect(async db => {
            const rows = await db.getAll(`SELECT f.*, COALESCE(r.renown, 0) AS renown,
                COALESCE(r.quests, 0) AS quests, COALESCE(r.solo_challenges, 0) AS solo_challenges
                FROM factions f LEFT JOIN character_faction_renown r
                ON r.faction_id = f.faction_id AND r.character_id = ?
                ORDER BY f.name_key, f.faction_id;`, [characterId]);
            if (!rows) { throw new Error('Could not read factions.'); }
            return rows;
        });
    }

    async find(selection) {
        return this.connect(async db => {
            const id = typeof selection === 'number' ? selection : /^faction:(\d+)$/.exec(selection || '')?.[1];
            const faction = id !== undefined ? await db.get('SELECT * FROM factions WHERE faction_id = ?;', [id]) :
                await db.get('SELECT * FROM factions WHERE name_key = ?;', [String(selection || '').trim().normalize('NFKC').toLowerCase()]);
            if (faction === false) { throw new Error('Could not read the faction.'); }
            return faction;
        });
    }

    async register(details) {
        const faction = factionDetails(details);
        return this.connect(async (db, run) => {
            if (await db.get('SELECT faction_id FROM factions WHERE name_key = ?;', [faction.name_key])) {
                throw new Error('A faction with that name is already registered in this server.');
            }
            await run('INSERT INTO factions (name, name_key, description, image_url) VALUES (?, ?, ?, ?);',
                [faction.name, faction.name_key, faction.description, faction.image_url]);
            return db.get('SELECT * FROM factions WHERE name_key = ?;', [faction.name_key]);
        }, true);
    }

    async edit(factionId, changes) {
        return this.connect(async (db, run) => {
            const current = await db.get('SELECT * FROM factions WHERE faction_id = ?;', [factionId]);
            if (!current) { throw new Error('That faction is no longer registered.'); }
            const faction = factionDetails({ ...current, ...changes });
            if (await db.get('SELECT faction_id FROM factions WHERE name_key = ? AND faction_id != ?;', [faction.name_key, factionId])) {
                throw new Error('A faction with that name is already registered in this server.');
            }
            await run('UPDATE factions SET name = ?, name_key = ?, description = ?, image_url = ? WHERE faction_id = ?;',
                [faction.name, faction.name_key, faction.description, faction.image_url, factionId]);
            return { faction_id: factionId, ...faction };
        }, true);
    }

    async award(characterId, factionId, changes) {
        const delta = {
            renown: changes.renown ?? 0,
            quests: changes.quests ?? 0,
            solo_challenges: changes.solo_challenges ?? 0,
        };
        if (Object.values(delta).some(value => !Number.isSafeInteger(value))) { throw new Error('Awards must be whole numbers.'); }
        if (Object.values(delta).every(value => value === 0)) { throw new Error('Provide a nonzero renown, quest, or solo-challenge award.'); }
        return this.connect(async (db, run) => {
            if (!await db.get('SELECT character_id FROM characters WHERE character_id = ?;', [characterId])) {
                throw new Error('That character does not exist.');
            }
            if (!await db.get('SELECT faction_id FROM factions WHERE faction_id = ?;', [factionId])) {
                throw new Error('That faction is no longer registered.');
            }
            const stored = await db.get('SELECT * FROM character_faction_renown WHERE character_id = ? AND faction_id = ?;', [characterId, factionId]);
            if (stored === false) { throw new Error('Could not read existing renown.'); }
            const before = stored || { renown: 0, quests: 0, solo_challenges: 0 };
            const after = {};
            for (const key of Object.keys(delta)) {
                after[key] = before[key] + delta[key];
                if (!Number.isSafeInteger(after[key])) { throw new Error('The resulting total is too large.'); }
            }
            if (after.quests < 0 || after.solo_challenges < 0) { throw new Error('Quest and solo-challenge totals cannot be negative.'); }
            await run(`INSERT INTO character_faction_renown (character_id, faction_id, renown, quests, solo_challenges)
                VALUES (?, ?, ?, ?, ?) ON CONFLICT(character_id, faction_id) DO UPDATE SET
                renown = excluded.renown, quests = excluded.quests, solo_challenges = excluded.solo_challenges;`,
            [characterId, factionId, after.renown, after.quests, after.solo_challenges]);
            return { before, after };
        }, true);
    }
}

module.exports = { factionService, factionDetails };
