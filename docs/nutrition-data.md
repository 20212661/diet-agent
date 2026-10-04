# Nutrition data policy

## Display rule

Calories are displayed or used for nutrition-based ranking only when a record includes the food match, portion amount and unit, cooking method, source record ID, and source release/version. A point value must have `status: "verified"`; uncertain values use a sourced lower/upper range, and records without enough evidence use `status: "unavailable"`. Legacy `estimatedCalories` values do not meet this rule and are suppressed.

The serving basis must describe the same prepared food and amount as the value. For a USDA value stated per 100 g, conversion requires a checked gram weight for the user's serving; volume and piece measures are not converted without a food-specific weight. A recipe-level value also needs an explicit yield/serving basis before it can be shown.

## Sources

- USDA FoodData Central API and downloadable datasets are the first candidate source. USDA describes FDC data as public domain/CC0 and asks users to cite FoodData Central. Keep the FDC ID, data type, and release date with every imported record: <https://fdc.nal.usda.gov/api-guide/> and <https://fdc.nal.usda.gov/download-datasets/>.
- China Food Composition Data Center should be assessed for coverage and terms before use: <https://fndc.chinanutri.cn/>. At the time of this implementation review, the portal required a signed-in account and SMS verification, and publicly accessible data-use terms could not be confirmed. No records were imported from it.

## Dataset status

`src/nutrition/nutritionCatalog.json` now contains all 7,793 SR Legacy foods with FoodData Central Energy (nutrient 1008) values. The source is the fixed April 2018 SR Legacy release. Each row preserves its FDC description, FDC ID, food category, kcal per 100 g, data type, and release. Previously curated Chinese names and aliases remain attached to their source records; untranslated rows use the official English description as their canonical name.

`search_nutrition_foods` searches the local catalog and returns at most 12 exact-source candidates. A record is eligible for calorie conversion only if it belongs to an allowed single-food category and its description does not indicate a mixed dish, sauce, restaurant meal, or similar composite food. The catalog includes 4,522 eligible records; the remaining SR Legacy records stay searchable for identification but cannot be passed to calorie calculation. The calculation tool still requires an exact record and user-provided grams. It never converts bowls, pieces, or spoons.

The data is a generic US food-composition reference, not a measurement of a Chinese recipe or a promise that a US cultivar, brand, or preparation matches the user's food. When preparation or identity is uncertain, keep the value unavailable. USDA requests citation of FoodData Central and describes the downloads as public domain/CC0: [API guide](https://fdc.nal.usda.gov/api-guide/), [download datasets and release dates](https://fdc.nal.usda.gov/download-datasets/).

To reproduce the bundled catalog from the official SR Legacy CSV release, place the extracted USDA tables under `data/fdc-sr-legacy-2018-04/` and run:

```bash
# Windows
py -3 scripts/build-nutrition-catalog.py
# macOS / Linux
python3 scripts/build-nutrition-catalog.py
```

The generator keeps the curated Chinese aliases, checks all 7,793 source IDs and kcal values, and emits a deterministic JSON catalog. The catalog validator rejects duplicate IDs, missing source metadata, or an incomplete release.

`NutritionEstimate` is the persisted contract. `estimate_food_calories` produces a verified value only for an exact, calculation-eligible catalog record with explicit grams. At write time, `isTraceableNutrition` re-computes the value from the bundled catalog and rejects model-supplied numbers that do not match its food state, source, record ID, version, and portion. Meal logs may omit nutrition; ranges and unavailable entries never contribute to an exact daily total.
