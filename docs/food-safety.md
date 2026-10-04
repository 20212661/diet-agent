# Recipe ingredient and allergen safety

## Data model

Every ingredient phrase in the recipe seed either maps through explicit aliases to one stable internal ingredient ID or is marked unresolved with a reason. Duplicate IDs and duplicate normalized aliases fail validation, and allergen tags are regenerated from the ingredient list. The validator compares the saved metadata with the taxonomy so seed edits cannot silently leave stale allergen tags behind.

The known allergen mapping covers the FDA's nine major food allergens: milk, egg, fish, crustacean shellfish, tree nuts, peanut, wheat, soy, and sesame. Gluten is also represented for user-reported gluten restrictions. Ingredient-name restrictions are matched directly as well, so a user can avoid a personally relevant food such as celery even though it is outside the FDA's nine-category labeling list.

Some recipe phrases describe a packaged product or a composite whose ingredients vary by recipe or brand. Those phrases live in `UNRESOLVED_RECIPE_INGREDIENTS` with a reason. When a user has an allergy or avoidance rule, a recipe containing one of these ingredients is held back until its composition can be checked. A new unmapped seed ingredient fails `npm run validate:recipes` until it is mapped or explicitly recorded as unresolved.

## Sources and reuse

- The allergen set follows the FDA's current nine major allergen categories: [FDA food allergy guidance](https://www.fda.gov/food/buy-store-serve-safe-food/food-allergies-what-you-need-know). Personal restrictions still apply outside that labeling set.
- The internal ingredient IDs and alias registry use the stable-concept plus synonym pattern used by [FoodOn](https://github.com/FoodOntology/foodon), a food ontology licensed CC BY 4.0. This project keeps a smaller Chinese recipe-oriented mapping rather than bundling the full ontology; FoodOn is the recommended source when adding interoperable food concept IDs and broader synonyms.
- Open Food Facts has useful ingredient and allergen taxonomies, but its product data is community-contributed and the project documents that it may be incomplete or inaccurate. Its database uses ODbL and its server uses AGPL; this application does not copy its data or code. See the [data/API documentation](https://github.com/openfoodfacts/openfoodfacts-server/blob/main/docs/api/index.md) and [server license](https://github.com/openfoodfacts/openfoodfacts-server).

The matcher is intentionally conservative for allergy-sensitive recommendations. It cannot verify cross-contact, restaurant handling, package-label changes, or a person's clinical diagnosis. Packaged and mixed ingredients still require label review; the matcher does not claim that a recipe is medically safe.
