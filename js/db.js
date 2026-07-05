/**
 * db.js — SQLite WASM 数据库加载层
 * 负责：下载 gzip 压缩的数据库 → 解压 → 加载到 sql.js → 缓存到 IndexedDB
 */

const DB_VERSION = 1; // 递增此值以强制刷新缓存

const DBManager = {
    db: null,
    SQL: null,
    ready: false,
    loadingPromise: null,

    DB_URL: 'data/mentors.db.gz',

    CACHE_DB_NAME: 'MentorEvalDB',
    CACHE_STORE_NAME: 'dbCache',
    CACHE_KEY: 'mentors.db',
    CACHE_VERSION_KEY: 'db_version',

    async init() {
        if (this.ready) return { db: this.db, SQL: this.SQL };
        if (this.loadingPromise) return this.loadingPromise;

        this.loadingPromise = this._doInit();
        return this.loadingPromise;
    },

    async _doInit() {
        try {
            this.SQL = await initSqlJs({
                locateFile: file => `lib/${file}`
            });
            updateProgress(10, 'SQLite 引擎就绪...');

            let buffer = await this._loadFromCache();

            if (!buffer) {
                buffer = await this._downloadAndDecompress();
                updateProgress(90, '正在缓存到本地...');
                await this._saveToCache(buffer);
            } else {
                updateProgress(90, '从本地缓存加载...');
            }

            updateProgress(95, '正在加载数据库...');
            this.db = new this.SQL.Database(new Uint8Array(buffer));
            this.ready = true;

            updateProgress(100, '就绪！');
            return { db: this.db, SQL: this.SQL };

        } catch (err) {
            console.error('数据库加载失败:', err);

            // 如果加载失败，清除可能损坏的缓存
            try { await this._clearCache(); } catch (e) {}

            // 重试一次（不使用缓存）
            try {
                updateProgress(0, '重试中...');
                const buffer = await this._downloadAndDecompress();
                this.db = new this.SQL.Database(new Uint8Array(buffer));
                this.ready = true;
                updateProgress(100, '就绪！');
                return { db: this.db, SQL: this.SQL };
            } catch (retryErr) {
                throw new Error(`数据库加载失败: ${err.message}`);
            }
        }
    },

    /** IndexedDB 缓存读取 */
    async _loadFromCache() {
        try {
            const idb = await this._openIndexedDB();

            // 检查版本
            const versionData = await this._idbGet(idb, this.CACHE_VERSION_KEY);
            if (!versionData || versionData.version !== DB_VERSION) {
                idb.close();
                return null;
            }

            const data = await this._idbGet(idb, this.CACHE_KEY);
            idb.close();

            if (data && data.buffer) return data.buffer;
        } catch (e) {
            console.warn('缓存读取失败:', e);
        }
        return null;
    },

    /** IndexedDB 缓存写入 */
    async _saveToCache(buffer) {
        try {
            const idb = await this._openIndexedDB();
            const tx = idb.transaction(this.CACHE_STORE_NAME, 'readwrite');
            const store = tx.objectStore(this.CACHE_STORE_NAME);
            store.put({ key: this.CACHE_KEY, buffer: buffer });
            store.put({ key: this.CACHE_VERSION_KEY, version: DB_VERSION });
            await new Promise((resolve, reject) => {
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
            });
            idb.close();
        } catch (e) {
            console.warn('缓存写入失败（可能是存储空间不足）:', e);
        }
    },

    /** 清除缓存 */
    async _clearCache() {
        const idb = await this._openIndexedDB();
        const tx = idb.transaction(this.CACHE_STORE_NAME, 'readwrite');
        const store = tx.objectStore(this.CACHE_STORE_NAME);
        store.delete(this.CACHE_KEY);
        store.delete(this.CACHE_VERSION_KEY);
        await new Promise(r => { tx.oncomplete = r; tx.onerror = r; });
        idb.close();
    },

    /** IndexedDB 单条读取 */
    _idbGet(db, key) {
        return new Promise((resolve, reject) => {
            const tx = db.transaction(this.CACHE_STORE_NAME, 'readonly');
            const store = tx.objectStore(this.CACHE_STORE_NAME);
            const req = store.get(key);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    },

    _openIndexedDB() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(this.CACHE_DB_NAME, 1);
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(this.CACHE_STORE_NAME)) {
                    db.createObjectStore(this.CACHE_STORE_NAME, { keyPath: 'key' });
                }
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    },

    /** 下载并解压数据库 */
    async _downloadAndDecompress() {
        updateProgress(15, '正在下载数据库...');
        updateHint('首次加载需下载约 27 MB 数据，请耐心等待。之后将使用浏览器缓存。');

        const response = await fetch(this.DB_URL);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: 数据库文件下载失败`);
        }

        const contentLength = parseInt(response.headers.get('content-length') || '0');
        const totalSize = contentLength || 27 * 1024 * 1024;

        // 流式读取响应
        const reader = response.body.getReader();
        const chunks = [];
        let received = 0;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            received += value.length;
            const pct = 15 + Math.round((received / totalSize) * 60);
            updateProgress(Math.min(pct, 75),
                `正在下载... ${(received / 1024 / 1024).toFixed(1)} / ${(totalSize / 1024 / 1024).toFixed(1)} MB`);
        }

        // 合并为单个 Uint8Array
        const compressed = new Uint8Array(received);
        let offset = 0;
        for (const chunk of chunks) {
            compressed.set(chunk, offset);
            offset += chunk.length;
        }

        updateProgress(78, '正在解压数据...');
        const decompressed = await this._decompressGzip(compressed);
        return decompressed.buffer;
    },

    /** gzip 解压：优先使用 DecompressionStream，回退到 pako */
    async _decompressGzip(compressed) {
        // 方法 1: 原生 DecompressionStream (Chrome 80+, Edge 80+, Firefox 113+, Safari 16.4+)
        if (typeof DecompressionStream !== 'undefined') {
            try {
                const blob = new Blob([compressed]);
                const ds = new DecompressionStream('gzip');
                const decompressedStream = blob.stream().pipeThrough(ds);
                const response = new Response(decompressedStream);
                return new Uint8Array(await response.arrayBuffer());
            } catch (e) {
                console.warn('DecompressionStream 失败，使用 pako 回退:', e);
            }
        }

        // 方法 2: pako.js 回退
        if (typeof pako !== 'undefined') {
            try {
                const decompressed = pako.inflate(compressed);
                return new Uint8Array(decompressed);
            } catch (e) {
                throw new Error('解压失败 (pako): ' + e.message);
            }
        }

        throw new Error('浏览器不支持 gzip 解压。请使用最新版 Chrome、Edge 或 Firefox 浏览器。');
    },

    /** SQL 查询 */
    query(sql, params = []) {
        if (!this.ready) throw new Error('数据库未初始化');
        const stmt = this.db.prepare(sql);
        if (params.length > 0) stmt.bind(params);
        const results = [];
        while (stmt.step()) {
            results.push(stmt.getAsObject());
        }
        stmt.free();
        return results;
    },

    /** 单值查询 */
    queryOne(sql, params = []) {
        const rows = this.query(sql, params);
        if (rows.length === 0) return null;
        return Object.values(rows[0])[0];
    },
};

function updateProgress(pct, text) {
    const fill = document.getElementById('progress-fill');
    const textEl = document.getElementById('progress-text');
    if (fill) fill.style.width = Math.min(pct, 100) + '%';
    if (textEl) textEl.textContent = text;
}

function updateHint(text) {
    const el = document.getElementById('loading-hint');
    if (el) el.textContent = text;
}
