/**
 * search.js — 搜索与筛选逻辑
 * 构建 SQL 查询，从 sql.js 数据库中检索导师评价
 */

const PAGE_SIZE = 20;

const SearchEngine = {
    /** 当前结果缓存 */
    _currentResults: [],
    _currentPage: 1,
    _totalResults: 0,

    /**
     * 执行搜索
     * @param {object} filters
     * @param {string} filters.keyword - 搜索关键词
     * @param {string} filters.school - 学校
     * @param {string} filters.department - 学院/专业
     * @param {number|null} filters.scoreMin - 最低评分
     * @param {number|null} filters.scoreMax - 最高评分
     * @param {string[]} filters.tags - 标签数组
     * @param {number} page - 页码
     * @returns {{ results: Array, total: number, page: number, pageSize: number }}
     */
    search(filters = {}, page = 1) {
        const db = DBManager.db;
        if (!db) return { results: [], total: 0, page: 1, pageSize: PAGE_SIZE };

        const conditions = [];
        const params = [];

        // 关键词搜索
        if (filters.keyword && filters.keyword.trim()) {
            const kw = '%' + filters.keyword.trim() + '%';
            conditions.push('(teacher LIKE ? OR school LIKE ? OR department LIKE ? OR content LIKE ?)');
            params.push(kw, kw, kw, kw);
        }

        // 学校筛选
        if (filters.school) {
            conditions.push('school = ?');
            params.push(filters.school);
        }

        // 学院筛选
        if (filters.department) {
            conditions.push('department = ?');
            params.push(filters.department);
        }

        // 评分范围
        if (filters.scoreMin !== null && filters.scoreMin !== undefined && filters.scoreMin !== '') {
            conditions.push('(score IS NOT NULL AND score >= ?)');
            params.push(parseFloat(filters.scoreMin));
        }
        if (filters.scoreMax !== null && filters.scoreMax !== undefined && filters.scoreMax !== '') {
            conditions.push('(score IS NOT NULL AND score <= ?)');
            params.push(parseFloat(filters.scoreMax));
        }

        // 标签筛选
        if (filters.tags && filters.tags.length > 0) {
            const tagConditions = filters.tags.map(tag => 'tags LIKE ?');
            conditions.push('(' + tagConditions.join(' OR ') + ')');
            for (const tag of filters.tags) {
                params.push('%' + tag + '%');
            }
        }

        const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

        // 查询总数（按导师分组数）
        const countSql = `SELECT COUNT(*) as cnt FROM (SELECT 1 FROM evaluations ${whereClause} GROUP BY teacher, school, department)`;
        this._totalResults = DBManager.queryOne(countSql, params) || 0;

        // 查询当前页（按导师分组，合并同导师的多条评价）
        // 先获取该页对应的导师-学校-学院组合
        const offset = (page - 1) * PAGE_SIZE;

        // 使用子查询获取去重后的导师组合
        const groupSql = `
            SELECT teacher, school, department,
                   COUNT(*) as eval_count,
                   AVG(score) as avg_score,
                   GROUP_CONCAT(DISTINCT tags) as all_tags
            FROM evaluations
            ${whereClause}
            GROUP BY teacher, school, department
            ORDER BY eval_count DESC, teacher ASC
            LIMIT ? OFFSET ?
        `;
        const groupParams = [...params, PAGE_SIZE, offset];

        const groups = DBManager.query(groupSql, groupParams);

        // 对每个导师组，获取其所有评价
        const results = groups.map(group => {
            const evalSql = `
                SELECT id, content, score, tags, source_file, source_sheet
                FROM evaluations
                WHERE teacher = ? AND school = ? AND department = ?
                ORDER BY score DESC, id ASC
            `;
            const evals = DBManager.query(evalSql, [
                group.teacher, group.school, group.department
            ]);

            return {
                teacher: group.teacher,
                school: group.school,
                department: group.department,
                evalCount: group.eval_count,
                avgScore: group.avg_score ? parseFloat(group.avg_score.toFixed(1)) : null,
                tags: this._parseTags(group.all_tags),
                evaluations: evals.map(e => ({
                    id: e.id,
                    content: e.content,
                    score: e.score,
                    tags: e.tags || '',
                    sourceFile: e.source_file || '',
                    sourceSheet: e.source_sheet || '',
                })),
            };
        });

        this._currentResults = results;
        this._currentPage = page;

        return {
            results,
            total: this._totalResults,
            page,
            pageSize: PAGE_SIZE,
            totalPages: Math.ceil(this._totalResults / PAGE_SIZE),
        };
    },

    /**
     * 获取所有学校列表（用于下拉框）
     */
    getSchools() {
        return DBManager.query(
            'SELECT DISTINCT school FROM evaluations ORDER BY school ASC'
        ).map(r => r.school);
    },

    /**
     * 获取某个学校的学院列表
     */
    getDepartments(school) {
        if (!school) {
            return DBManager.query(
                'SELECT DISTINCT department FROM evaluations WHERE department != "" ORDER BY department ASC'
            ).map(r => r.department);
        }
        return DBManager.query(
            'SELECT DISTINCT department FROM evaluations WHERE school = ? AND department != "" ORDER BY department ASC',
            [school]
        ).map(r => r.department);
    },

    /**
     * 获取数据统计
     */
    getStats() {
        const total = DBManager.queryOne('SELECT COUNT(*) FROM evaluations');
        const schools = DBManager.queryOne('SELECT COUNT(DISTINCT school) FROM evaluations');
        const teachers = DBManager.queryOne('SELECT COUNT(DISTINCT teacher) FROM evaluations');
        return { total, schools, teachers };
    },

    /**
     * 解析逗号分隔的标签
     */
    _parseTags(tagStr) {
        if (!tagStr) return [];
        const tags = new Set();
        tagStr.split(',').forEach(t => {
            t = t.trim();
            if (t && t !== 'nan') tags.add(t);
        });
        return Array.from(tags);
    },
};
