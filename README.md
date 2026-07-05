# 导师评价信息检索系统

纯静态网页，使用 SQLite WASM (sql.js) 在浏览器端检索导师评价数据。

## 本地测试

```bash
cd web
python -m http.server 8080
# 打开 http://localhost:8080
```

## 部署到 GitHub Pages

1. 在 GitHub 新建仓库（如 `mentor-search`）
2. 只上传 `web/` 目录下的文件（不要上传 `data/mentors.db` 未压缩版）
3. 仓库 Settings → Pages → Source: `main` 分支 → Save
4. 等待几分钟，访问 `https://<用户名>.github.io/mentor-search/`

```bash
cd web
git init
git add index.html css/ js/ lib/ data/mentors.db.gz .gitignore
git commit -m "Initial commit"
git remote add origin https://github.com/<用户名>/mentor-search.git
git push -u origin main
```

## 部署到 Netlify

1. 注册 https://app.netlify.com
2. 将 `web/` 文件夹拖拽到 Netlify Drop 区域
3. 自动部署，获得 `https://xxx.netlify.app` 地址

## 更新数据库

如果 Excel 数据更新了，重新运行数据处理脚本：

```bash
cd data
python process.py
# 重新压缩
cd ../web/data
python -c "import gzip; gzip.open('mentors.db.gz','wb',9).write(open('mentors.db','rb').read())"
```

然后重新部署（数据库缓存通过 `DB_VERSION` 自动失效）。

## 技术栈

- **sql.js** (SQLite WebAssembly) — 浏览器端 SQL 查询
- **pako.js** — gzip 解压回退方案
- **DecompressionStream API** — 原生 gzip 解压
- **IndexedDB** — 数据库本地缓存
- 纯 HTML/CSS/JS，零后端依赖
