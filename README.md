# 苍穹打击者 · Sky Striker

竖版浏览器射击游戏（HTML5 Canvas + Cloudflare Worker）。

- 线上：https://air.5201616.xyz （镜像 air.minispacex.com）
- 玩法：15 关、僚机上限成长、彩京风三段蓄力、周榜/月榜

## 本地

```bash
npx wrangler dev
```

## 部署

```bash
npx wrangler deploy
```

排行榜使用 KV 绑定 `RANKS`（见 `wrangler.toml`）。
