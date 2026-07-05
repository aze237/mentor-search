/**
 * app.js — UI 交互控制
 * 负责：页面初始化、搜索事件绑定、结果渲染、弹窗管理
 */

const App = {
    /** 防抖定时器 */
    _debounceTimer: null,
    /** 当前筛选条件 */
    _filters: {
        keyword: '',
        school: '',
        department: '',
        scoreMin: null,
        scoreMax: null,
        tags: [],
    },

    /**
     * 初始化应用
     */
    async init() {
        try {
            // 加载数据库
            await DBManager.init();

            // 隐藏加载界面，显示主界面
            document.getElementById('loading-screen').style.display = 'none';
            document.getElementById('app').style.display = 'block';

            // 初始化 UI
            this._initUI();
            this._bindEvents();
            this._updateStats();

            // 初始加载（显示空状态与总数）
            this._showEmptyState();

        } catch (err) {
            this._showError('数据库加载失败: ' + err.message);
        }
    },

    /**
     * 初始化 UI 元素
     */
    _initUI() {
        // 填充学校下拉框
        const schools = SearchEngine.getSchools();
        const schoolSelect = document.getElementById('filter-school');
        schools.forEach(s => {
            const opt = document.createElement('option');
            opt.value = s;
            opt.textContent = s;
            schoolSelect.appendChild(opt);
        });

        // 填充学院下拉框（初始为空，选择学校后联动）
        this._updateDepartmentOptions();
    },

    /**
     * 绑定事件
     */
    _bindEvents() {
        const self = this;

        // 搜索按钮
        document.getElementById('search-btn').addEventListener('click', () => {
            self._doSearch();
        });

        // 搜索框回车
        document.getElementById('search-input').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') self._doSearch();
        });

        // 搜索框输入防抖
        document.getElementById('search-input').addEventListener('input', () => {
            clearTimeout(self._debounceTimer);
            self._debounceTimer = setTimeout(() => self._doSearch(), 400);
        });

        // 学校筛选变化 → 联动学院 + 自动搜索
        document.getElementById('filter-school').addEventListener('change', function() {
            self._updateDepartmentOptions();
            self._doSearch();
        });

        // 学院筛选变化 → 自动搜索
        document.getElementById('filter-department').addEventListener('change', () => {
            self._doSearch();
        });

        // 评分范围变化 → 自动搜索（防抖）
        const scoreHandler = () => {
            clearTimeout(self._debounceTimer);
            self._debounceTimer = setTimeout(() => self._doSearch(), 500);
        };
        document.getElementById('filter-score-min').addEventListener('input', scoreHandler);
        document.getElementById('filter-score-max').addEventListener('input', scoreHandler);

        // 标签筛选变化 → 自动搜索
        document.querySelectorAll('.tag-checkbox input[type="checkbox"]').forEach(cb => {
            cb.addEventListener('change', () => self._doSearch());
        });

        // 重置按钮
        document.getElementById('reset-btn').addEventListener('click', () => {
            self._resetFilters();
        });

        // 弹窗关闭
        document.getElementById('modal-overlay').addEventListener('click', () => {
            self._closeModal();
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') self._closeModal();
        });
    },

    /**
     * 执行搜索
     */
    _doSearch(page = 1) {
        this._readFilters();

        // 如果完全无筛选条件，显示空状态
        const hasFilter = this._filters.keyword ||
            this._filters.school ||
            this._filters.department ||
            (this._filters.scoreMin !== null && this._filters.scoreMin !== '') ||
            (this._filters.scoreMax !== null && this._filters.scoreMax !== '') ||
            this._filters.tags.length > 0;

        if (!hasFilter) {
            this._showEmptyState();
            return;
        }

        const result = SearchEngine.search(this._filters, page);
        this._renderResults(result);
    },

    /**
     * 读取表单筛选条件
     */
    _readFilters() {
        this._filters.keyword = document.getElementById('search-input').value.trim();
        this._filters.school = document.getElementById('filter-school').value;
        this._filters.department = document.getElementById('filter-department').value;

        const minVal = document.getElementById('filter-score-min').value;
        const maxVal = document.getElementById('filter-score-max').value;
        this._filters.scoreMin = minVal !== '' ? parseFloat(minVal) : null;
        this._filters.scoreMax = maxVal !== '' ? parseFloat(maxVal) : null;

        this._filters.tags = [];
        document.querySelectorAll('.tag-checkbox input[type="checkbox"]:checked').forEach(cb => {
            this._filters.tags.push(cb.value);
        });
    },

    /**
     * 重置筛选条件
     */
    _resetFilters() {
        document.getElementById('search-input').value = '';
        document.getElementById('filter-school').value = '';
        document.getElementById('filter-department').value = '';
        document.getElementById('filter-score-min').value = '';
        document.getElementById('filter-score-max').value = '';
        document.querySelectorAll('.tag-checkbox input[type="checkbox"]').forEach(cb => {
            cb.checked = false;
        });
        this._updateDepartmentOptions();
        this._showEmptyState();
    },

    /**
     * 更新学院下拉框
     */
    _updateDepartmentOptions() {
        const school = document.getElementById('filter-school').value;
        const depts = SearchEngine.getDepartments(school);
        const deptSelect = document.getElementById('filter-department');
        deptSelect.innerHTML = '<option value="">全部学院</option>';
        depts.forEach(d => {
            const opt = document.createElement('option');
            opt.value = d;
            opt.textContent = d;
            deptSelect.appendChild(opt);
        });
    },

    /**
     * 显示空状态
     */
    _showEmptyState() {
        const stats = SearchEngine.getStats();
        document.getElementById('total-count').textContent = (stats.total || 0).toLocaleString();
        document.getElementById('results-container').innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">🔍</div>
                <p>输入关键词或选择筛选条件开始搜索</p>
                <p class="empty-hint">共收录 <strong>${(stats.total || 0).toLocaleString()}</strong> 条评价，<strong>${(stats.schools || 0).toLocaleString()}</strong> 所学校，<strong>${(stats.teachers || 0).toLocaleString()}</strong> 位导师</p>
            </div>
        `;
        document.getElementById('result-summary').textContent = '';
        document.getElementById('pagination').innerHTML = '';
    },

    /**
     * 渲染搜索结果
     */
    _renderResults(result) {
        const { results, total, page, totalPages } = result;
        const container = document.getElementById('results-container');
        const summary = document.getElementById('result-summary');
        const pagination = document.getElementById('pagination');

        // 结果统计
        if (total === 0) {
            summary.textContent = '未找到匹配结果';
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">😕</div>
                    <p>未找到匹配的导师评价</p>
                    <p class="empty-hint">请尝试调整搜索关键词或筛选条件</p>
                </div>
            `;
            pagination.innerHTML = '';
            return;
        }

        summary.textContent = `找到 ${total.toLocaleString()} 个导师-学院组合，当前显示第 ${page} 页`;

        // 渲染导师卡片
        let html = '';
        results.forEach((group, idx) => {
            html += this._renderMentorCard(group, idx);
        });
        container.innerHTML = html;

        // 绑定卡片点击事件
        container.querySelectorAll('.mentor-header').forEach(header => {
            header.addEventListener('click', function() {
                this.classList.toggle('expanded');
                const evalList = this.nextElementSibling;
                evalList.classList.toggle('expanded');
            });
        });

        // 绑定展开/收起评价内容
        container.querySelectorAll('.eval-content-truncated').forEach(el => {
            const moreBtn = el.nextElementSibling;
            if (moreBtn && moreBtn.classList.contains('eval-content-more')) {
                moreBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    el.classList.remove('eval-content-truncated');
                    el.classList.add('expanded');
                    moreBtn.style.display = 'none';
                });
            }
        });

        // 渲染分页
        this._renderPagination(page, totalPages);
    },

    /**
     * 渲染单个导师分组卡片
     */
    _renderMentorCard(group, idx) {
        const avatarText = group.teacher.charAt(0);
        const avgScore = group.avgScore !== null ? group.avgScore.toFixed(1) : null;

        // 标签徽章
        let badgesHtml = '';
        if (avgScore !== null) {
            badgesHtml += `<span class="badge badge-score">⭐ ${avgScore}</span>`;
        }
        badgesHtml += `<span class="badge badge-count">📋 ${group.evalCount} 条评价</span>`;
        if (group.tags.includes('黑名单')) {
            badgesHtml += `<span class="badge badge-blacklist">⚠ 黑名单</span>`;
        }
        if (group.tags.includes('五星推荐')) {
            badgesHtml += `<span class="badge badge-star">🌟 五星推荐</span>`;
        }

        // 评价列表
        let evalsHtml = '';
        group.evaluations.forEach((ev, i) => {
            let scoreBadge = '';
            if (ev.score !== null) {
                let cls = 'eval-score-mid';
                if (ev.score >= 4) cls = 'eval-score-high';
                else if (ev.score < 2) cls = 'eval-score-low';
                scoreBadge = `<span class="eval-score ${cls}">⭐ ${ev.score.toFixed(1)}</span>`;
            } else {
                scoreBadge = `<span class="eval-score eval-score-none">无评分</span>`;
            }

            const contentClass = ev.content.length > 300 ? 'eval-content eval-content-truncated' : 'eval-content';
            const moreBtn = ev.content.length > 300
                ? '<span class="eval-content-more">展开全文 ▼</span>'
                : '';

            let sourceInfo = '';
            if (ev.sourceFile) {
                sourceInfo = `来源: ${ev.sourceFile}`;
                if (ev.sourceSheet && ev.sourceSheet !== '1' && ev.sourceSheet !== '工作表1') {
                    sourceInfo += ` / ${ev.sourceSheet}`;
                }
            }

            const tagLabels = [];
            if (ev.tags) {
                const t = ev.tags.split(',').map(s => s.trim()).filter(s => s && s !== 'nan');
                if (t.includes('黑名单')) tagLabels.push('⚠ 黑名单');
                if (t.includes('五星推荐')) tagLabels.push('🌟 五星推荐');
            }

            evalsHtml += `
                <div class="eval-item">
                    <div class="${contentClass}">${this._escapeHtml(ev.content)}</div>
                    ${moreBtn}
                    <div class="eval-meta">
                        ${scoreBadge}
                        ${tagLabels.map(t => `<span class="eval-score eval-score-none">${t}</span>`).join(' ')}
                        <span>${sourceInfo}</span>
                    </div>
                </div>
            `;
        });

        return `
            <div class="mentor-group">
                <div class="mentor-header">
                    <div class="mentor-avatar">${avatarText}</div>
                    <div class="mentor-info">
                        <div class="mentor-name">${this._escapeHtml(group.teacher)}</div>
                        <div class="mentor-meta">🏫 ${this._escapeHtml(group.school)} ${group.department ? '· 📚 ' + this._escapeHtml(group.department) : ''}</div>
                    </div>
                    <div class="mentor-badges">${badgesHtml}</div>
                    <span class="mentor-expand-icon">▼</span>
                </div>
                <div class="mentor-evaluations">${evalsHtml}</div>
            </div>
        `;
    },

    /**
     * 渲染分页
     */
    _renderPagination(currentPage, totalPages) {
        const container = document.getElementById('pagination');
        if (totalPages <= 1) {
            container.innerHTML = '';
            return;
        }

        let html = '';
        html += `<button ${currentPage === 1 ? 'disabled' : ''} data-page="${currentPage - 1}">◀ 上一页</button>`;

        // 页码按钮
        const maxButtons = 7;
        let startPage = Math.max(1, currentPage - Math.floor(maxButtons / 2));
        let endPage = Math.min(totalPages, startPage + maxButtons - 1);
        if (endPage - startPage < maxButtons - 1) {
            startPage = Math.max(1, endPage - maxButtons + 1);
        }

        if (startPage > 1) {
            html += `<button data-page="1">1</button>`;
            if (startPage > 2) html += `<span class="pagination-info">...</span>`;
        }

        for (let i = startPage; i <= endPage; i++) {
            html += `<button data-page="${i}" class="${i === currentPage ? 'active' : ''}">${i}</button>`;
        }

        if (endPage < totalPages) {
            if (endPage < totalPages - 1) html += `<span class="pagination-info">...</span>`;
            html += `<button data-page="${totalPages}">${totalPages}</button>`;
        }

        html += `<button ${currentPage === totalPages ? 'disabled' : ''} data-page="${currentPage + 1}">下一页 ▶</button>`;
        html += `<span class="pagination-info">共 ${totalPages} 页</span>`;

        container.innerHTML = html;

        // 绑定分页按钮事件
        container.querySelectorAll('button[data-page]').forEach(btn => {
            btn.addEventListener('click', () => {
                const page = parseInt(btn.dataset.page);
                this._doSearch(page);
                // 滚动到顶部
                window.scrollTo({ top: 0, behavior: 'smooth' });
            });
        });
    },

    /**
     * 更新顶部统计
     */
    _updateStats() {
        const stats = SearchEngine.getStats();
        document.getElementById('header-stats').textContent =
            `${(stats.total || 0).toLocaleString()} 条评价 · ${(stats.schools || 0).toLocaleString()} 所学校 · ${(stats.teachers || 0).toLocaleString()} 位导师`;
    },

    /**
     * 关闭弹窗
     */
    _closeModal() {
        document.getElementById('detail-modal').classList.remove('active');
    },

    /**
     * 显示错误
     */
    _showError(msg) {
        document.getElementById('loading-screen').innerHTML = `
            <div class="loading-container">
                <div class="loading-icon">⚠️</div>
                <h2 style="color:#fff;">加载失败</h2>
                <p style="color:rgba(255,255,255,0.8);">${msg}</p>
                <button onclick="location.reload()" style="margin-top:20px;padding:10px 24px;border:none;border-radius:8px;background:#fff;color:#333;font-size:14px;cursor:pointer;">重新加载</button>
            </div>
        `;
    },

    /**
     * HTML 转义
     */
    _escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },
};

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
    App.init();
});
