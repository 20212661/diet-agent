#!/usr/bin/env node

import "dotenv/config";
import { checkModelConfiguration, formatModelCheckResult } from "./agent/configDoctor.js";

const result = await checkModelConfiguration();
console.log(formatModelCheckResult(result));

if (result.severity === "error") {
  console.log("请检查 .env 中的 MODEL_PROVIDER、MODEL_ID 和对应 API Key；诊断不会输出 Key 内容。");
  process.exitCode = 1;
}
