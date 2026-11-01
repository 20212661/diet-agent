/**
 * HowToCook 源码获取：固定 commit + tarball sha256 双重校验，双源回退。
 *
 * 为什么不 vendor 进仓库：源仓库含大量图片资产（~111MB），vendoring 会
 * 把"数据不进 git"的 data/ 撑爆，且与"导入记录保留 commit"职责重复。
 * 管道是离线手动运行的：首次下载校验后解压到 data/howtocook-src/<commit>/
 * （gitignore），二次运行零网络依赖。commit + sha256 常量保证任何机器上
 * 拉到的字节完全一致——sha256 是"可复现"的真正保证（jsDelivr 回退源也
 * 用同一校验）。
 */
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { existsSync, readFileSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";

export const HTC_REPO = "Anduin2017/HowToCook";
export const HTC_COMMIT = "308cc8b7dab1da84b20e7fafdf836a715437f582";
/** codeload.github.com 拉取的 tarball 摘要；jsDelivr 回退源必须产出相同字节。 */
export const HTC_TARBALL_SHA256 = "41220fe0898414e354851242c0d3fa0185ffbb8a2905cdff84c8b72277a29991";

const TARBALL_URLS = [
  `https://codeload.github.com/${HTC_REPO}/tar.gz/${HTC_COMMIT}`,
  `https://codeload.jsdelivr.net/gh/${HTC_REPO}@${HTC_COMMIT}/tar.gz`,
];

export function sha256Of(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

/** 下载 + 校验 + 解压。缓存命中时直接返回目录；任何一步失败都抛错，不部分落盘。 */
export function ensureHtcSourceAvailable(cacheRoot: string): string {
  const sourceDir = join(cacheRoot, HTC_COMMIT.slice(0, 7));
  if (existsSync(join(sourceDir, "dishes"))) return sourceDir;

  let lastError: unknown;
  for (const url of TARBALL_URLS) {
    try {
      execSync(`curl -sL --max-time 300 -o "${join(cacheRoot, "htc.tar.gz")}" "${url}"`, { stdio: "pipe" });
      const buffer = readFileSync(join(cacheRoot, "htc.tar.gz"));
      const digest = sha256Of(buffer);
      if (digest !== HTC_TARBALL_SHA256) {
        throw new Error(`tarball sha256 不一致：期望 ${HTC_TARBALL_SHA256}，实际 ${digest}（${url}）`);
      }
      execSync(`tar -xzf "${join(cacheRoot, "htc.tar.gz")}" -C "${cacheRoot}"`, { stdio: "pipe" });
      // GitHub tarball 解压出 HowToCook-<full-commit>/，重命名为短 commit 目录
      renameSync(join(cacheRoot, `${HTC_REPO.split("/")[1]}-${HTC_COMMIT}`), sourceDir);
      rmSync(join(cacheRoot, "htc.tar.gz"), { force: true });
      if (!existsSync(join(sourceDir, "dishes"))) throw new Error("解压后缺少 dishes/ 目录");
      return sourceDir;
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`HowToCook 源获取失败（已尝试 ${TARBALL_URLS.length} 个源）：${String(lastError)}`);
}
