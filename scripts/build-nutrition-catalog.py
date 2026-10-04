#!/usr/bin/env python3
"""Build the bundled exact-match catalog from USDA SR Legacy CSV files."""

import argparse
import csv
import json
from pathlib import Path
import re


SINGLE_FOOD_CATEGORIES = {
    "1", "2", "4", "5", "9", "10", "11", "12", "13", "15", "16", "17", "20",
}
COMPOSITE_PATTERN = re.compile(
    r"\b(?:restaurant|babyfood|baby food|fast foods?|mixed|mixture|blend|soup|sauce|"
    r"dressing|salad|sandwich|casserole|entree|pie|cake|cookie|biscuit|waffle|"
    r"pancake|pastry|snack|candy|pizza|burger|pudding|custard|curry)\b|,\s*and\s",
    re.IGNORECASE,
)
CHINESE_ALIASES = {
    "170026": ["土豆（生）", "生土豆", "马铃薯（生）"],
    "170000": ["洋葱（生）", "生洋葱"],
    "170393": ["胡萝卜（生）", "生胡萝卜"],
    "168434": ["蘑菇（生）", "双孢菇（生）"],
    "168389": ["芦笋（生）", "生芦笋"],
    "169230": ["大蒜（生）", "蒜（生）"],
    "170427": ["青椒（生）", "青甜椒（生）"],
    "170108": ["红椒（生）", "红甜椒（生）"],
    "170005": ["小葱（生）", "香葱（生）"],
    "168458": ["紫菜（生）", "紫菜（鲜）"],
    "169231": ["姜（生）", "生姜"],
    "170457": ["番茄（生）", "西红柿（生）"],
    "169988": ["芹菜（生）", "生芹菜"],
    "169382": ["金针菇（生）"],
    "169228": ["茄子（生）", "生茄子"],
    "169210": ["竹笋（生）", "笋（生）"],
    "168409": ["黄瓜（带皮，生）", "黄瓜（生）"],
    "169979": ["大白菜（生）", "白菜（生）"],
    "169997": ["香菜（生）", "芫荽（生）"],
    "167746": ["柠檬（生，去皮）"],
    "168448": ["南瓜（生）"],
    "169702": ["小米（生）"],
    "169330": ["西兰花（生）"],
    "168230": ["猪里脊（生，瘦肉）"],
    "172448": ["北豆腐（硬，未烹调）", "硬豆腐（未烹调）"],
    "171287": ["鸡蛋（生，全蛋）"],
    "169282": ["毛豆（生，大豆）", "青大豆（生）"],
    "168482": ["红薯（生）", "甘薯（生）"],
    "169242": ["香菇（生）"],
    "175179": ["虾（生）", "虾仁（生）"],
}


def read_csv(path: Path):
    with path.open("r", encoding="utf-8-sig", newline="") as source:
        return list(csv.DictReader(source))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--source-dir",
        type=Path,
        default=Path("data/fdc-sr-legacy-2018-04/FoodData_Central_sr_legacy_food_csv_2018-04"),
        help="Directory containing USDA SR Legacy food.csv and food_nutrient.csv",
    )
    parser.add_argument("--output", type=Path, default=Path("src/nutrition/nutritionCatalog.json"))
    args = parser.parse_args()

    source_dir = args.source_dir
    foods = read_csv(source_dir / "food.csv")
    nutrients = read_csv(source_dir / "food_nutrient.csv")
    categories = {row["id"]: row["description"] for row in read_csv(source_dir / "food_category.csv")}
    existing = json.loads(args.output.read_text(encoding="utf-8"))
    curated_by_fdc = {entry["fdcId"]: entry for entry in existing}

    energy_by_fdc = {}
    for row in nutrients:
        if row["nutrient_id"] != "1008":  # FoodData Central Energy (kcal)
            continue
        if row["fdc_id"] in energy_by_fdc:
            raise ValueError(f"Duplicate Energy (1008) value for FDC ID {row['fdc_id']}")
        energy_by_fdc[row["fdc_id"]] = float(row["amount"])

    catalog = []
    seen_ids = set()
    for food in foods:
        fdc_id = food["fdc_id"]
        if food["data_type"] != "sr_legacy_food" or fdc_id not in energy_by_fdc:
            continue
        description = food["description"].strip()
        if not description:
            continue
        category_id = food["food_category_id"]
        category = categories.get(category_id, "Unknown")
        calculation_allowed = category_id in SINGLE_FOOD_CATEGORIES and not COMPOSITE_PATTERN.search(description)
        curated = curated_by_fdc.get(fdc_id)
        calories = energy_by_fdc[fdc_id]
        if curated:
            if abs(float(curated["caloriesPer100g"]) - calories) > 0.05:
                raise ValueError(f"Curated calories disagree with USDA row {fdc_id}: {description}")
            curated["foodCategory"] = category
            curated["calculationAllowed"] = calculation_allowed
            curated["aliases"] = sorted(set(curated.get("aliases", []) + CHINESE_ALIASES.get(fdc_id, [])))
            catalog.append(curated)
        else:
            catalog.append({
                "id": f"fdc-{fdc_id}",
                "aliases": CHINESE_ALIASES.get(fdc_id, []),
                "fdcDescription": description,
                "fdcId": fdc_id,
                "dataType": "sr_legacy_food",
                "sourceVersion": "FDC SR Legacy 2018-04",
                "caloriesPer100g": calories,
                "cookingMethod": "按 USDA 英文食品描述；不推断或转换烹饪状态",
                "referenceGrams": 100,
                "foodCategory": category,
                "calculationAllowed": calculation_allowed,
            })
        if fdc_id in seen_ids:
            raise ValueError(f"Duplicate FDC ID {fdc_id}")
        seen_ids.add(fdc_id)

    omitted = set(curated_by_fdc) - seen_ids
    if omitted:
        raise ValueError(f"Curated records absent from USDA source: {', '.join(sorted(omitted))}")

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Built {len(catalog)} USDA SR Legacy energy records at {args.output}")


if __name__ == "__main__":
    main()
