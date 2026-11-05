/**
 * Vitest 全局 setup：数据库测试隔离兜底。
 *
 * ① 默认内存库：setupFiles 先于测试文件模块图加载执行，database.ts 模块顶层
 *   读 DIET_AGENT_DB_PATH 时拿到的就是 ":memory:"——静态 import 链同样被覆盖。
 *   需要文件库的测试（迁移备份等）自行把 env 指到 os.tmpdir() 下的临时目录。
 * ② 真实库守卫：DIET_AGENT_TEST_DB_GUARD 让 getDatabase 拒绝打开项目 data/
 *   下的真实数据库（历史事故：测试连上真实库并对其跑迁移）。
 */
process.env.DIET_AGENT_DB_PATH ||= ":memory:";
process.env.DIET_AGENT_TEST_DB_GUARD = "1";
