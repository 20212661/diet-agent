/**
 * 厨具/食材分离：HowToCook 把工具混写在"必备原料和工具"里，
 * 用词表按子串匹配分离。词表取自现有 69 道种子菜的 cookware 值
 * 加常见补充项；P1 漏斗报告会输出分离效果与漏网抽样，长尾项
 * 在 P2 分类表审核时一并补。
 */

const UTENSIL_WORDS: readonly string[] = [
  // 种子菜 cookware 值
  "炒锅", "汤锅", "平底锅", "烤盘", "烤箱", "盘子", "带盖",
  // 常见锅具/电器
  "奶锅", "砂锅", "蒸锅", "蒸笼", "高压锅", "电饭煲", "电饭锅", "微波炉", "空气炸锅", "电磁炉", "电陶炉", "灶",
  "炖锅", "铸铁锅", "不粘锅", "雪平锅", "塔吉锅", "煲",
  // 工具/器具
  "铲", "勺", "筷子", "碗", "砧板", "菜板", "案板", "刀", "剪刀", "削皮器", "刨丝器", "擦丝器",
  "擀面杖", "保鲜膜", "保鲜袋", "打蛋器", "搅拌机", "破壁机", "豆浆机", "榨汁机", "量杯", "量勺",
  "厨房秤", "电子秤", "秤", "滤网", "漏勺", "漏盆", "纱布", "锡纸", "烘焙纸", "油纸", "厨房纸",
  "手套", "刮刀", "模具", "吐司模", "烤纸", "竹签", "牙签", "捣蒜器", "蒜臼", "漏斗", "开罐器",
  "裱花袋", "裱花嘴", "温度计", "计时器", "锅盖", "盖子", "盆", "杯子", "碟", "饭盒", "密封罐", "罐子",
  // P1 首跑漏网抽样补充
  "密封袋", "面包机", "铁锅", "煎锅", "电锅", "深锅", "煮锅", "汤煲", "炖盅", "石锅", "铜锅",
];

export interface UtensilSeparation {
  foods: string[];
  utensils: string[];
}

export function separateUtensils(items: readonly string[]): UtensilSeparation {
  const foods: string[] = [];
  const utensils: string[] = [];
  for (const item of items) {
    if (UTENSIL_WORDS.some((word) => item.includes(word))) utensils.push(item);
    else foods.push(item);
  }
  return { foods, utensils };
}
