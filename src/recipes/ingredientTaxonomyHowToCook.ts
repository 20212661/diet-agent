// 自动生成：npm run import:htc -- --stage write-taxonomy（判定=人工规则表+扫表定案 2026-11-02）。请勿手改，重跑生成器覆写。
// 数据来源 HowToCook（Unlicense）commit 308cc8b 的食材聚类；人工补丁见 src/import/howtocook/writeTaxonomy.ts。
import type { AllergenId } from "../types/diet.js";

export const HTC_INGREDIENT_DEFINITIONS: ReadonlyArray<{
  id: string; aliases: string[]; allergens: AllergenId[]; possibleAllergens: AllergenId[];
}> = [
  {
    "id": "salt",
    "aliases": [
      "盐",
      "食用盐",
      "食盐",
      "精盐",
      "盐 5g",
      "海盐",
      "盐巴"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "cooking_oil",
    "aliases": [
      "食用油",
      "油",
      "植物油"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "cooking_wine",
    "aliases": [
      "料酒",
      "料酒、朗姆酒或啤酒",
      "料酒 5ml"
    ],
    "allergens": [
      "gluten",
      "wheat"
    ],
    "possibleAllergens": []
  },
  {
    "id": "starch",
    "aliases": [
      "淀粉",
      "生粉",
      "地瓜粉",
      "淀粉 10g",
      "水淀粉",
      "红薯淀粉"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "water",
    "aliases": [
      "水",
      "清水",
      "开水",
      "热水",
      "冷水",
      "饮用水",
      "温水",
      "温水( 40℃ )",
      "矿泉水",
      "水 400ml"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "pepper_powder",
    "aliases": [
      "胡椒粉",
      "白胡椒粉"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "bay_leaf",
    "aliases": [
      "香叶"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "vinegar",
    "aliases": [
      "醋",
      "米醋",
      "陈醋",
      "醋 15ml"
    ],
    "allergens": [],
    "possibleAllergens": [
      "gluten",
      "wheat"
    ]
  },
  {
    "id": "cassia_bark",
    "aliases": [
      "桂皮"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "msg",
    "aliases": [
      "味精",
      "味素"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "aromatic_vinegar",
    "aliases": [
      "香醋"
    ],
    "allergens": [
      "gluten",
      "wheat"
    ],
    "possibleAllergens": []
  },
  {
    "id": "five_spice_powder",
    "aliases": [
      "五香粉"
    ],
    "allergens": [],
    "possibleAllergens": [
      "wheat"
    ]
  },
  {
    "id": "beer",
    "aliases": [
      "啤酒",
      "漓泉啤酒"
    ],
    "allergens": [
      "gluten"
    ],
    "possibleAllergens": [
      "wheat"
    ]
  },
  {
    "id": "cumin_powder",
    "aliases": [
      "孜然粉"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "garam_masala",
    "aliases": [
      "印度综合香料粉"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "thirteen_spice",
    "aliases": [
      "十三香"
    ],
    "allergens": [],
    "possibleAllergens": [
      "wheat"
    ]
  },
  {
    "id": "white_vinegar",
    "aliases": [
      "白醋"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "fermented_black_bean",
    "aliases": [
      "豆豉",
      "阳江豆豉"
    ],
    "allergens": [
      "soy"
    ],
    "possibleAllergens": []
  },
  {
    "id": "rapeseed_oil",
    "aliases": [
      "菜籽油"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "htc_cooking_wine",
    "aliases": [
      "料酒/黄酒",
      "料酒 15ml",
      "黄酒或料酒",
      "料酒或者黄酒",
      "料酒或花雕酒"
    ],
    "allergens": [
      "gluten",
      "wheat"
    ],
    "possibleAllergens": []
  },
  {
    "id": "yeast",
    "aliases": [
      "干酵母",
      "酵母",
      "安琪干酵母粉",
      "酵母粉"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "processed_pork",
    "aliases": [
      "加工肉制品",
      "火腿肠",
      "午餐肉罐头",
      "腊肠 1 根",
      "培根"
    ],
    "allergens": [],
    "possibleAllergens": [
      "gluten",
      "soy",
      "wheat"
    ]
  },
  {
    "id": "vegetable_oil",
    "aliases": [
      "食用油/植物油",
      "食用植物油",
      "油 15 ml"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "ham",
    "aliases": [
      "火腿"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "winter_melon",
    "aliases": [
      "冬瓜"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "daikon_radish",
    "aliases": [
      "白萝卜"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "bean_sprouts",
    "aliases": [
      "豆芽"
    ],
    "allergens": [],
    "possibleAllergens": [
      "soy"
    ]
  },
  {
    "id": "crab",
    "aliases": [
      "螃蟹",
      "青蟹",
      "肉蟹"
    ],
    "allergens": [
      "shellfish"
    ],
    "possibleAllergens": []
  },
  {
    "id": "chicken_bouillon",
    "aliases": [
      "鸡精/鸡粉",
      "鸡精：可选"
    ],
    "allergens": [
      "gluten",
      "wheat"
    ],
    "possibleAllergens": [
      "egg"
    ]
  },
  {
    "id": "chili_oil",
    "aliases": [
      "油泼辣子"
    ],
    "allergens": [],
    "possibleAllergens": [
      "sesame"
    ]
  },
  {
    "id": "pepper_oil",
    "aliases": [
      "藤椒油"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "angelica_dahurica",
    "aliases": [
      "白芷"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "chives",
    "aliases": [
      "韭菜"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "cauliflower",
    "aliases": [
      "花菜"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "pork_ribs",
    "aliases": [
      "肋排"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "pickled_chili",
    "aliases": [
      "泡椒"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "chu_hou_sauce",
    "aliases": [
      "柱侯酱"
    ],
    "allergens": [],
    "possibleAllergens": [
      "gluten",
      "soy",
      "wheat"
    ]
  },
  {
    "id": "chicken_feet",
    "aliases": [
      "鸡爪"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "lamb_ribs",
    "aliases": [
      "羊排"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "baking_soda",
    "aliases": [
      "小苏打"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "cumin_seed",
    "aliases": [
      "孜然籽"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "rice_noodle",
    "aliases": [
      "米粉"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "chili_sauce",
    "aliases": [
      "老干妈"
    ],
    "allergens": [
      "soy"
    ],
    "possibleAllergens": []
  },
  {
    "id": "zucchini",
    "aliases": [
      "西葫芦"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "white_wine",
    "aliases": [
      "白葡萄酒"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "steamed_rice_powder",
    "aliases": [
      "蒸肉粉",
      "蒸肉米粉 100g"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "herbs",
    "aliases": [
      "香草",
      "香料",
      "干罗勒或百里香"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "htc_starch",
    "aliases": [
      "淀粉/生粉"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "pork_trotter",
    "aliases": [
      "猪蹄"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "chestnut",
    "aliases": [
      "板栗",
      "栗子"
    ],
    "allergens": [
      "tree_nut"
    ],
    "possibleAllergens": []
  },
  {
    "id": "yam",
    "aliases": [
      "山药"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "lotus_seed",
    "aliases": [
      "莲子",
      "去心莲子"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "青豆_豌豆",
    "aliases": [
      "青豆/豌豆",
      "青豆",
      "冷冻青豆"
    ],
    "allergens": [],
    "possibleAllergens": [
      "soy"
    ]
  },
  {
    "id": "instant_noodles",
    "aliases": [
      "方便面/泡面",
      "方便面",
      "泡面"
    ],
    "allergens": [
      "gluten",
      "wheat"
    ],
    "possibleAllergens": [
      "egg",
      "milk",
      "soy"
    ]
  },
  {
    "id": "mustard",
    "aliases": [
      "芥末"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "rice_wine",
    "aliases": [
      "米酒"
    ],
    "allergens": [],
    "possibleAllergens": [
      "gluten",
      "wheat"
    ]
  },
  {
    "id": "baking_powder",
    "aliases": [
      "泡打粉"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "parsley",
    "aliases": [
      "欧芹",
      "新鲜欧芹"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "mirin",
    "aliases": [
      "味淋",
      "日式味淋"
    ],
    "allergens": [],
    "possibleAllergens": [
      "gluten",
      "wheat"
    ]
  },
  {
    "id": "cumin",
    "aliases": [
      "孜然"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "mint",
    "aliases": [
      "薄荷叶",
      "新鲜薄荷叶"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "chinese_sausage",
    "aliases": [
      "腊肠",
      "黔式腊肠"
    ],
    "allergens": [],
    "possibleAllergens": [
      "gluten",
      "soy",
      "wheat"
    ]
  },
  {
    "id": "coconut_milk",
    "aliases": [
      "椰浆"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "eel",
    "aliases": [
      "鳝丝"
    ],
    "allergens": [
      "fish"
    ],
    "possibleAllergens": []
  },
  {
    "id": "hotpot_base",
    "aliases": [
      "火锅底料"
    ],
    "allergens": [],
    "possibleAllergens": [
      "gluten",
      "soy",
      "wheat"
    ]
  },
  {
    "id": "tofu_skin",
    "aliases": [
      "千张"
    ],
    "allergens": [
      "soy"
    ],
    "possibleAllergens": []
  },
  {
    "id": "mung_bean_sprouts",
    "aliases": [
      "绿豆芽"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "oyster",
    "aliases": [
      "生蚝"
    ],
    "allergens": [
      "shellfish"
    ],
    "possibleAllergens": []
  },
  {
    "id": "rice_cake",
    "aliases": [
      "年糕"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "seafood_sauce",
    "aliases": [
      "海鲜酱"
    ],
    "allergens": [],
    "possibleAllergens": [
      "gluten",
      "sesame",
      "soy",
      "wheat"
    ]
  },
  {
    "id": "sea_cucumber",
    "aliases": [
      "海参"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "razor_clam",
    "aliases": [
      "蛏子"
    ],
    "allergens": [
      "shellfish"
    ],
    "possibleAllergens": []
  },
  {
    "id": "jam",
    "aliases": [
      "果酱"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "water_or_stock",
    "aliases": [
      "温水/高汤",
      "温水或高汤"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "longan",
    "aliases": [
      "桂圆"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "速冻水饺",
    "aliases": [
      "速冻水饺",
      "饺子"
    ],
    "allergens": [
      "gluten",
      "wheat"
    ],
    "possibleAllergens": [
      "egg",
      "soy"
    ]
  },
  {
    "id": "fennel",
    "aliases": [
      "茴香"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "black_tea",
    "aliases": [
      "红茶"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "steamed_bun",
    "aliases": [
      "花卷",
      "冷冻花卷"
    ],
    "allergens": [
      "gluten",
      "wheat"
    ],
    "possibleAllergens": []
  },
  {
    "id": "glutinous_rice_cake",
    "aliases": [
      "糍粑"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "htc_ham",
    "aliases": [
      "火腿片"
    ],
    "allergens": [],
    "possibleAllergens": [
      "gluten",
      "soy",
      "wheat"
    ]
  },
  {
    "id": "tsaoko",
    "aliases": [
      "草果"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "cordyceps_flower",
    "aliases": [
      "虫草花"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "rabbit_meat",
    "aliases": [
      "兔肉"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "sand_ginger",
    "aliases": [
      "山奈"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "white_cardamom",
    "aliases": [
      "白蔻"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "fennel_seed",
    "aliases": [
      "小茴香"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "drinking_water",
    "aliases": [
      "凉白开水"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "braising_spice_packet",
    "aliases": [
      "卤料包"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "cooking_wine_or_beer",
    "aliases": [
      "料酒/啤酒",
      "料酒或啤酒"
    ],
    "allergens": [
      "gluten",
      "wheat"
    ],
    "possibleAllergens": []
  },
  {
    "id": "canned_pineapple",
    "aliases": [
      "罐头菠萝片"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "osmunda_fern",
    "aliases": [
      "商芝"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "chicken_broth",
    "aliases": [
      "鸡汤"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "clove",
    "aliases": [
      "丁香"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "new_orleans_seasoning",
    "aliases": [
      "新奥尔良烤翅调料"
    ],
    "allergens": [],
    "possibleAllergens": [
      "soy",
      "wheat"
    ]
  },
  {
    "id": "meat_unspecified",
    "aliases": [
      "肉类"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "salt_baked_chicken_powder",
    "aliases": [
      "盐焗鸡粉"
    ],
    "allergens": [
      "gluten",
      "wheat"
    ],
    "possibleAllergens": [
      "egg"
    ]
  },
  {
    "id": "chicken_liver",
    "aliases": [
      "鸡肝",
      "生鸡肝"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "mixed_seasoning",
    "aliases": [
      "复合调味料"
    ],
    "allergens": [
      "gluten",
      "wheat"
    ],
    "possibleAllergens": [
      "egg"
    ]
  },
  {
    "id": "bbq_seasoning_or_cumin_powder",
    "aliases": [
      "烧烤料/孜然粉",
      "烧烤料或孜然粉"
    ],
    "allergens": [],
    "possibleAllergens": [
      "soy",
      "wheat"
    ]
  },
  {
    "id": "bullfrog_meat",
    "aliases": [
      "牛蛙肉"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "masala_powder",
    "aliases": [
      "Masala 粉"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "htc_vinegar",
    "aliases": [
      "黑醋/陈醋",
      "黑醋"
    ],
    "allergens": [
      "gluten",
      "wheat"
    ],
    "possibleAllergens": []
  },
  {
    "id": "blood_sausage",
    "aliases": [
      "血肠"
    ],
    "allergens": [],
    "possibleAllergens": [
      "gluten",
      "wheat"
    ]
  },
  {
    "id": "pickled_cabbage",
    "aliases": [
      "酸菜"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "lamb_brisket",
    "aliases": [
      "羊腩"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "yuba",
    "aliases": [
      "腐竹"
    ],
    "allergens": [
      "soy"
    ],
    "possibleAllergens": []
  },
  {
    "id": "huadiao_wine_or_baijiu",
    "aliases": [
      "花雕酒/白酒",
      "花雕酒，白酒"
    ],
    "allergens": [],
    "possibleAllergens": [
      "gluten",
      "wheat"
    ]
  },
  {
    "id": "non_ingredient_note",
    "aliases": [
      "非食材说明",
      "原则：万物皆可酿"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "preserved_mustard_greens",
    "aliases": [
      "梅菜"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "pepper_salt_powder",
    "aliases": [
      "椒盐粉"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "custard_powder",
    "aliases": [
      "吉士粉"
    ],
    "allergens": [],
    "possibleAllergens": [
      "egg",
      "milk"
    ]
  },
  {
    "id": "celtuce_tip",
    "aliases": [
      "凤尾"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "thin_pancake",
    "aliases": [
      "小薄饼"
    ],
    "allergens": [
      "gluten",
      "wheat"
    ],
    "possibleAllergens": []
  },
  {
    "id": "glutinous_rice_flour",
    "aliases": [
      "糯米粉"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "rice_flour",
    "aliases": [
      "粘米粉"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "htc_cumin_seed",
    "aliases": [
      "孜然粒"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "bbq_seasoning",
    "aliases": [
      "烧烤撒料"
    ],
    "allergens": [],
    "possibleAllergens": [
      "gluten",
      "peanut",
      "sesame",
      "soy",
      "wheat"
    ]
  },
  {
    "id": "steak_sauce",
    "aliases": [
      "预制牛排酱汁"
    ],
    "allergens": [],
    "possibleAllergens": [
      "gluten",
      "soy",
      "wheat"
    ]
  },
  {
    "id": "pork_skin",
    "aliases": [
      "猪皮"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "htc_pickled_cabbage",
    "aliases": [
      "东北酸菜"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "river_snail",
    "aliases": [
      "田螺",
      "大田螺"
    ],
    "allergens": [
      "shellfish"
    ],
    "possibleAllergens": []
  },
  {
    "id": "perilla",
    "aliases": [
      "紫苏叶"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "guilin_sanhua_wine",
    "aliases": [
      "桂林三花酒"
    ],
    "allergens": [],
    "possibleAllergens": [
      "gluten",
      "wheat"
    ]
  },
  {
    "id": "lamb_rib",
    "aliases": [
      "带皮羊排肉"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "angelica",
    "aliases": [
      "当归"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "white_kidney_bean",
    "aliases": [
      "白芸豆"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "wasabi",
    "aliases": [
      "青芥末"
    ],
    "allergens": [],
    "possibleAllergens": [
      "gluten",
      "wheat"
    ]
  },
  {
    "id": "water_bamboo",
    "aliases": [
      "茭白"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "pineapple",
    "aliases": [
      "凤梨"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "snow_pea",
    "aliases": [
      "荷兰豆"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "cinnamon",
    "aliases": [
      "肉桂皮"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "cardamom",
    "aliases": [
      "豆蔻"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "sweet_potato_vermicelli",
    "aliases": [
      "红薯粉丝"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "alcoholic_beverage",
    "aliases": [
      "酒类",
      "酒"
    ],
    "allergens": [],
    "possibleAllergens": [
      "gluten",
      "wheat"
    ]
  },
  {
    "id": "condiment_unspecified",
    "aliases": [
      "小料"
    ],
    "allergens": [],
    "possibleAllergens": [
      "gluten",
      "peanut",
      "sesame",
      "soy",
      "wheat"
    ]
  },
  {
    "id": "htc_eel",
    "aliases": [
      "白鳝",
      "白鱔"
    ],
    "allergens": [
      "fish"
    ],
    "possibleAllergens": []
  },
  {
    "id": "fermented_rice_lees",
    "aliases": [
      "酒糟"
    ],
    "allergens": [],
    "possibleAllergens": [
      "gluten",
      "wheat"
    ]
  },
  {
    "id": "htc_chili_sauce",
    "aliases": [
      "香辣酱"
    ],
    "allergens": [],
    "possibleAllergens": [
      "gluten",
      "soy",
      "wheat"
    ]
  },
  {
    "id": "方便面",
    "aliases": [
      "北京麻辣方便面"
    ],
    "allergens": [
      "gluten",
      "wheat"
    ],
    "possibleAllergens": [
      "soy"
    ]
  },
  {
    "id": "htc_cardamom",
    "aliases": [
      "小豆蔻粉"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "fenugreek_leaves",
    "aliases": [
      "葫芦巴叶"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "bitter_melon",
    "aliases": [
      "苦瓜"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "soybean_oil",
    "aliases": [
      "熟豆油/豆油",
      "熟豆油"
    ],
    "allergens": [
      "soy"
    ],
    "possibleAllergens": []
  },
  {
    "id": "daylily",
    "aliases": [
      "黄花菜",
      "黄花"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "lamb_or_offal",
    "aliases": [
      "羊肉/羊杂",
      "羊肉或羊杂"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "glutinous_rice",
    "aliases": [
      "糯米"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "red_bean",
    "aliases": [
      "红豆"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "coix_seed",
    "aliases": [
      "薏米"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "black_rice",
    "aliases": [
      "黑米"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "mung_bean",
    "aliases": [
      "绿豆"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "soybean",
    "aliases": [
      "黄豆"
    ],
    "allergens": [
      "soy"
    ],
    "possibleAllergens": []
  },
  {
    "id": "kidney_bean",
    "aliases": [
      "红腰豆"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "htc_longan",
    "aliases": [
      "桂圆/龙眼干"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "raisin",
    "aliases": [
      "葡萄干"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "pigeon",
    "aliases": [
      "乳鸽"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "white_fungus",
    "aliases": [
      "银耳"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "tangerine_peel",
    "aliases": [
      "陈皮"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "american_ginseng",
    "aliases": [
      "西洋参"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "dendrobium",
    "aliases": [
      "石斛"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "polygonatum_odoratum",
    "aliases": [
      "玉竹"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "ophiopogon",
    "aliases": [
      "麦冬"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "seasoning_blend",
    "aliases": [
      "风味调料/复合调味料",
      "风味调料"
    ],
    "allergens": [],
    "possibleAllergens": [
      "egg",
      "gluten",
      "soy",
      "wheat"
    ]
  },
  {
    "id": "roasted_chickpea_flour",
    "aliases": [
      "烤鹰嘴豆粉"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "mustard_oil",
    "aliases": [
      "芥末油"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "saffron",
    "aliases": [
      "藏红花"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "dough",
    "aliases": [
      "面团"
    ],
    "allergens": [
      "gluten",
      "wheat"
    ],
    "possibleAllergens": []
  },
  {
    "id": "wheat_gluten",
    "aliases": [
      "谷朊粉"
    ],
    "allergens": [
      "gluten",
      "wheat"
    ],
    "possibleAllergens": []
  },
  {
    "id": "vanilla_extract",
    "aliases": [
      "香草精"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "recipe_section_heading",
    "aliases": [
      "原料"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "pasta_sauce",
    "aliases": [
      "意大利面酱"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "htc_cauliflower",
    "aliases": [
      "花椰菜"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "htc_mixed_seasoning",
    "aliases": [
      "盐 + 鸡精 + 十三香"
    ],
    "allergens": [
      "gluten",
      "wheat"
    ],
    "possibleAllergens": [
      "egg"
    ]
  },
  {
    "id": "wheat_pancake",
    "aliases": [
      "白面煎饼/山东煎饼",
      "白面煎饼"
    ],
    "allergens": [
      "gluten",
      "wheat"
    ],
    "possibleAllergens": []
  },
  {
    "id": "starch_noodles",
    "aliases": [
      "粉条"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "liangfen",
    "aliases": [
      "凉粉"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "htc_rice_cake",
    "aliases": [
      "年糕/白粿"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "htc_steamed_bun",
    "aliases": [
      "馒头"
    ],
    "allergens": [
      "gluten",
      "wheat"
    ],
    "possibleAllergens": []
  },
  {
    "id": "pickled_beans",
    "aliases": [
      "酸豆角"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "meat_stock",
    "aliases": [
      "肉汤汁"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "dried_radish",
    "aliases": [
      "萝卜干"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "crackers",
    "aliases": [
      "丽滋饼干"
    ],
    "allergens": [
      "gluten",
      "wheat"
    ],
    "possibleAllergens": [
      "milk",
      "soy"
    ]
  },
  {
    "id": "kidney_beans",
    "aliases": [
      "红芸豆"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "cooking_oil_or_ghee",
    "aliases": [
      "食用油或酥油"
    ],
    "allergens": [],
    "possibleAllergens": [
      "milk"
    ]
  },
  {
    "id": "htc_bay_leaf",
    "aliases": [
      "月桂叶"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "cured_pork",
    "aliases": [
      "腊肉",
      "煮熟的腊肉"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "luosifen",
    "aliases": [
      "螺蛳粉"
    ],
    "allergens": [
      "shellfish",
      "soy"
    ],
    "possibleAllergens": [
      "fish",
      "gluten",
      "peanut",
      "wheat"
    ]
  },
  {
    "id": "snail_meat",
    "aliases": [
      "螺蛳肉",
      "螺蛳肉包"
    ],
    "allergens": [
      "shellfish"
    ],
    "possibleAllergens": []
  },
  {
    "id": "soup_base",
    "aliases": [
      "汤料包"
    ],
    "allergens": [],
    "possibleAllergens": [
      "fish",
      "gluten",
      "shellfish",
      "soy",
      "wheat"
    ]
  },
  {
    "id": "buckwheat_noodles",
    "aliases": [
      "荞麦面"
    ],
    "allergens": [],
    "possibleAllergens": [
      "gluten",
      "wheat"
    ]
  },
  {
    "id": "fern_root_noodles",
    "aliases": [
      "蕨根粉"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "tangyuan",
    "aliases": [
      "小汤圆"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "fermented_glutinous_rice",
    "aliases": [
      "醪糟"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "gochujang",
    "aliases": [
      "韩式辣酱"
    ],
    "allergens": [
      "gluten",
      "soy",
      "wheat"
    ],
    "possibleAllergens": []
  },
  {
    "id": "sprite",
    "aliases": [
      "雪碧"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "stock_or_bouillon",
    "aliases": [
      "高汤/浓汤宝",
      "高汤或浓汤宝"
    ],
    "allergens": [],
    "possibleAllergens": [
      "gluten",
      "soy",
      "wheat"
    ]
  },
  {
    "id": "pork_skin_jelly",
    "aliases": [
      "皮冻"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "chickpea",
    "aliases": [
      "鹰嘴豆"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "black_tea_bag",
    "aliases": [
      "红茶包"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "luncheon_meat",
    "aliases": [
      "午餐肉/火腿肠",
      "午餐肉"
    ],
    "allergens": [],
    "possibleAllergens": [
      "gluten",
      "soy",
      "wheat"
    ]
  },
  {
    "id": "radish",
    "aliases": [
      "萝卜"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "glass_noodles",
    "aliases": [
      "粉丝"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "bottle_gourd",
    "aliases": [
      "瓠瓜"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "chickpea_flour",
    "aliases": [
      "鹰嘴豆粉",
      "鹰嘴豆粉(Besan)"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "lotus_root",
    "aliases": [
      "莲藕"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "pepper_salt",
    "aliases": [
      "椒盐"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "olive_vegetable",
    "aliases": [
      "橄榄菜"
    ],
    "allergens": [],
    "possibleAllergens": [
      "gluten",
      "soy",
      "wheat"
    ]
  },
  {
    "id": "stir_fry_seasoning",
    "aliases": [
      "炒菜料",
      "李大厨牌子的炒菜料"
    ],
    "allergens": [],
    "possibleAllergens": [
      "egg",
      "gluten",
      "sesame",
      "soy",
      "wheat"
    ]
  },
  {
    "id": "meat_flavoring",
    "aliases": [
      "肉香味调味料",
      "李大厨牌子的肉香味"
    ],
    "allergens": [],
    "possibleAllergens": [
      "egg",
      "gluten",
      "milk",
      "soy",
      "wheat"
    ]
  },
  {
    "id": "choy_sum",
    "aliases": [
      "菜心",
      "新鲜菜心"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "tea_tree_mushroom",
    "aliases": [
      "茶树菇",
      "闽星茶树菇"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "spinach",
    "aliases": [
      "菠菜"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "water_spinach",
    "aliases": [
      "空心菜"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "kabayaki_sauce",
    "aliases": [
      "蒲烧汁"
    ],
    "allergens": [
      "gluten",
      "soy",
      "wheat"
    ],
    "possibleAllergens": [
      "fish"
    ]
  },
  {
    "id": "crab_mushroom",
    "aliases": [
      "蟹味菇"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "white_beech_mushroom",
    "aliases": [
      "白玉菇"
    ],
    "allergens": [],
    "possibleAllergens": []
  },
  {
    "id": "edamame",
    "aliases": [
      "毛豆"
    ],
    "allergens": [
      "soy"
    ],
    "possibleAllergens": []
  },
  {
    "id": "preserved_plum",
    "aliases": [
      "话梅"
    ],
    "allergens": [],
    "possibleAllergens": []
  }
];

export const HTC_ALIAS_EXTENSIONS: Readonly<Record<string, string[]>> = {
  "chili": [
    "尖椒"
  ],
  "sesame": [
    "麻油"
  ],
  "beef": [
    "牛排"
  ],
  "pork": [
    "咸肉"
  ],
  "green_beans": [
    "豆角"
  ],
  "oyster_sauce": [
    "耗油"
  ],
  "rice": [],
  "black_pepper": [
    "黑椒"
  ],
  "bell_pepper": [
    "灯笼椒",
    "菜椒"
  ],
  "fermented_tofu": [
    "南乳"
  ],
  "cabbage": [
    "包菜"
  ],
  "milk": [
    "有盐黄油/牛油",
    "有盐牛油"
  ],
  "pasta": [
    "通心粉"
  ],
  "tomato": [
    "番茄酱/茄汁",
    "茄汁",
    "蕃茄酱"
  ],
  "tofu": [
    "豆干",
    "香干"
  ],
  "wheat_noodle": [
    "面"
  ],
  "soy_sauce": [
    "味极鲜"
  ],
  "wheat_wrapper": [
    "手抓饼皮"
  ],
  "whole_chicken": [
    "鸡",
    "半只鸡"
  ],
  "chicken": [],
  "chicken_thigh": [
    "手枪腿/鸡胸肉",
    "手枪腿"
  ],
  "duck": [
    "鸭子"
  ],
  "chicken_wing": [
    "鸡全翅"
  ],
  "carrot": [
    "胡箩卜"
  ],
  "mushroom": [
    "菌菇"
  ],
  "vegetables": [
    "自选蔬菜"
  ],
  "corn": [
    "玉米/粟米",
    "粟米"
  ],
  "enoki": [
    "金菇"
  ],
  "shiitake": [
    "香菇/冬菇",
    "冬菇"
  ],
  "pea": [],
  "dumpling_wrapper": [
    "饺子皮/馄饨皮",
    "烧卖皮"
  ],
  "tree_nut": [
    "松子仁",
    "熟松子仁"
  ],
  "broccoli": [
    "西蓝花"
  ]
};
