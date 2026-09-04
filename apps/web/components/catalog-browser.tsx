"use client";

import { catalog, type CatalogCategory } from "@pa/types";
import { useMemo, useState } from "react";
import styles from "./catalog-browser.module.css";

export function CatalogBrowser() {
  const [rootSlug, setRootSlug] = useState(catalog[0]?.slug ?? "");
  const [childSlug, setChildSlug] = useState(catalog[0]?.children?.[0]?.slug ?? "");
  const root = useMemo(() => catalog.find((item) => item.slug === rootSlug) ?? catalog[0], [rootSlug]);
  const child = root?.children?.find((item) => item.slug === childSlug) ?? root?.children?.[0];

  function selectRoot(category: CatalogCategory) {
    setRootSlug(category.slug);
    setChildSlug(category.children?.[0]?.slug ?? "");
  }

  return (
    <div className={styles.browser}>
      <div className={styles.roots}>
        {catalog.map((category) => (
          <button
            type="button"
            key={category.slug}
            className={category.slug === root?.slug ? styles.activeRoot : styles.root}
            onClick={() => selectRoot(category)}
          >
            <span>{category.icon ?? "•"}</span>
            <b>{category.name}</b>
            <small>{category.description ?? `${category.children?.length ?? 0} sous-catégories`}</small>
          </button>
        ))}
      </div>

      <div className={styles.content}>
        <div>
          <p className={styles.kicker}>Sous-catégorie</p>
          <h3>{root?.name}</h3>
          <div className={styles.children}>
            {root?.children?.map((category) => (
              <button
                type="button"
                key={category.slug}
                onClick={() => setChildSlug(category.slug)}
                className={category.slug === child?.slug ? styles.activeChild : styles.child}
              >
                {category.name}<span>›</span>
              </button>
            ))}
          </div>
        </div>

        <aside className={styles.preview}>
          <p className={styles.kicker}>Champs adaptés automatiquement</p>
          <h3>{child?.name ?? "Choisissez une catégorie"}</h3>
          <p className={styles.muted}>Les mêmes attributs alimentent le formulaire de dépôt et les filtres de recherche.</p>
          <div className={styles.tags}>
            {(child?.filters ?? []).slice(0, 10).map((filter) => (
              <span key={filter.key}>{filter.label}{filter.unit ? ` · ${filter.unit}` : ""}</span>
            ))}
          </div>
          {child?.domain === "VEHICLE" && <div className={styles.notice}>Plaque FR → pré-remplissage fournisseur agréé</div>}
          {child?.domain === "REAL_ESTATE" && <div className={styles.notice}>DPE + GES intégrés aux informations énergétiques</div>}
          {child?.domain === "ANIMAL" && <div className={styles.notice}>Champs d’identification et conformité adaptés à l’animal</div>}
        </aside>
      </div>
    </div>
  );
}
