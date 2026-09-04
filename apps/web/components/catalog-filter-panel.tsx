"use client";

import { flattenDeepCatalog } from "@pa/types";
import { useMemo, useState } from "react";
import styles from "./catalog-filter-panel.module.css";

const categories = flattenDeepCatalog().filter((category) => !category.children?.length);

export function CatalogFilterPanel() {
  const [slug, setSlug] = useState("voitures-suv");
  const category = useMemo(() => categories.find((item) => item.slug === slug) ?? categories[0], [slug]);

  return (
    <aside className={styles.panel}>
      <div className={styles.head}>
        <span>Filtres</span>
        <button type="button">Réinitialiser</button>
      </div>

      <label className={styles.field}>
        <span>Catégorie</span>
        <select value={slug} onChange={(event) => setSlug(event.target.value)}>
          {categories.map((item) => <option value={item.slug} key={item.slug}>{item.name}</option>)}
        </select>
      </label>

      <div className={styles.priceGrid}>
        <label className={styles.field}><span>Prix min.</span><input type="number" placeholder="0 €" /></label>
        <label className={styles.field}><span>Prix max.</span><input type="number" placeholder="Max" /></label>
      </div>

      <label className={styles.field}>
        <span>Localisation</span>
        <input placeholder="Ville ou code postal" />
      </label>

      <label className={styles.field}>
        <span>Rayon</span>
        <select defaultValue="30"><option value="10">10 km</option><option value="30">30 km</option><option value="50">50 km</option><option value="100">100 km</option><option value="200">200 km</option></select>
      </label>

      <div className={styles.separator} />
      <div className={styles.dynamicHead}>
        <b>{category?.name}</b>
        <small>{category?.filters?.length ?? 0} filtres spécifiques</small>
      </div>

      {(category?.filters ?? []).map((filter) => (
        <label className={styles.field} key={`${category?.slug}-${filter.key}`}>
          <span>{filter.label}{filter.unit ? ` (${filter.unit})` : ""}</span>
          {filter.type === "SELECT" || filter.type === "MULTISELECT" ? (
            <select defaultValue="">
              <option value="">Tous</option>
              {(filter.options ?? []).map((option) => <option key={option}>{option}</option>)}
            </select>
          ) : filter.type === "BOOLEAN" ? (
            <select defaultValue=""><option value="">Indifférent</option><option>Oui</option><option>Non</option></select>
          ) : filter.type === "NUMBER" ? (
            <input type="number" placeholder={filter.unit ? `En ${filter.unit}` : "Valeur"} />
          ) : filter.type === "DATE" ? (
            <input type="date" />
          ) : (
            <input placeholder={filter.label} />
          )}
        </label>
      ))}

      <button className={styles.apply} type="button">Afficher les résultats</button>
    </aside>
  );
}
