/**
 * 否决捕获小评测：10 段对话，三种方式（仅规则 / 仅 LLM / 规则+LLM）的捕获率与误捕率。
 *
 * 标注来源（如实注明）：对话段与期望否决集由 **LLM 标注**（GLM 起草，待人工扫审），
 * 菜名取自真实菜谱库（187 道）。特征否决段（F7/F8）的"哪些菜符合特征"也是 LLM 判断。
 *
 * 段型：
 *  - R1-R6：点名否决（规则层应捕获；说法各不相同：换掉/不想吃/吃腻了/去掉/就算了换别的/不要+菜名紧邻）
 *  - F7-F8：按特征否决（规则层判不了，LLM 从"上轮推荐过的菜"里挑）
 *  - N9-N10：易误捕段（期望**不**捕获）：推荐集外的菜+否认词；否定之否定
 */

export interface RejectionScenario {
  id: string;
  /** 上一轮工具结果推荐过的菜名（规则层输入）。 */
  suggestedNames: string[];
  message: string;
  /** 期望被否决的菜名（空=期望不捕获）。 */
  expectedRejected: string[];
}

export const REJECTION_SCENARIOS: readonly RejectionScenario[] = [
  {
    id: "R1",
    suggestedNames: ["白灼虾", "蒜蓉粉丝蒸虾", "番茄炒蛋"],
    message: "第一天的白灼虾换掉吧，换个别的",
    expectedRejected: ["白灼虾"],
  },
  {
    id: "R2",
    suggestedNames: ["白灼虾", "蒜蓉粉丝蒸虾", "番茄炒蛋"],
    message: "蒜蓉粉丝蒸虾不想吃了",
    expectedRejected: ["蒜蓉粉丝蒸虾"],
  },
  {
    id: "R3",
    suggestedNames: ["番茄炒蛋", "蒸蛋羹", "紫菜蛋花汤"],
    message: "番茄炒蛋吃腻了，这周换一个",
    expectedRejected: ["番茄炒蛋"],
  },
  {
    id: "R4",
    suggestedNames: ["花蛤豆腐汤", "葱烧豆腐"],
    message: "把花蛤豆腐汤从计划里去掉",
    expectedRejected: ["花蛤豆腐汤"],
  },
  {
    id: "R5",
    suggestedNames: ["太阳蛋", "苏格兰蛋"],
    message: "太阳蛋就算了，换别的吧",
    expectedRejected: ["太阳蛋"],
  },
  {
    id: "R6",
    suggestedNames: ["蛋炒饭", "紫菜蛋花汤"],
    message: "今晚不要蛋炒饭了，改吃面",
    expectedRejected: ["蛋炒饭"],
  },
  {
    id: "F7",
    suggestedNames: ["咖喱鸡块", "凉拌豆腐", "白灼虾"],
    message: "太油的都不要，来点清淡的",
    expectedRejected: ["咖喱鸡块"],
  },
  {
    id: "F8",
    suggestedNames: ["排骨炖土豆", "蒜蓉西兰花"],
    message: "带骨头的这次就先算了，处理起来麻烦",
    expectedRejected: ["排骨炖土豆"],
  },
  {
    id: "N9",
    suggestedNames: ["白灼虾", "番茄炒蛋"],
    message: "红烧肉不错，不过今天不想吃",
    expectedRejected: [],
  },
  {
    id: "N10",
    suggestedNames: ["蒸蛋羹", "太阳蛋"],
    message: "都行，你看着办，没有不吃的",
    expectedRejected: [],
  },
];
