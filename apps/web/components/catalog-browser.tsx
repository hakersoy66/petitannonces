"use client";

import { catalog, type CatalogCategory, type CatalogFilter } from "@pa/types";
import { useMemo, useState } from "react";
import { smartphoneModels, vehicleModels, propertyExtras } from "../lib/catalog-presets";
import styles from "./catalog-browser.module.css";

function DynamicField({ filter, categorySlug, brand, onBrandChange }: { filter: CatalogFilter; categorySlug: string; brand: string; onBrandChange: (value: string) => void }) {
  const isVehicle = ["voitures", "motos", "scooters", "utilitaires", "camping-cars-caravanes"].includes(categorySlug);
  const isPhone = categorySlug === "telephones-smartphones";
  const brandMap = isVehicle ? vehicleModels : isPhone ? smartphoneModels : undefined;

  if (filter.key === "brand" && brandMap) {
    return (
      <label className={styles.field}>
        <span>{filter.label}{filter.required ? " *" : ""}</span>
        <select value={brand} onChange={(event) => onBrandChange(event.target.value)}>
          <option value="">Choisir une marque</option>
          {Object.keys(brandMap).map((item) => <option key={item}>{item}</option>)}
          <option>Autre</option>
        </select>
      </label>
    );
  }

  if (filter.key === "model" && brandMap) {
    const models = brandMap[brand] ?? [];
    return (
      <label className={styles.field}>
        <span>{filter.label}{filter.required ? " *" : ""}</span>
        <select disabled={!brand} defaultValue="">
          <option value="">{brand ? "Choisir un modèle" : "Choisir d’abord la marque"}</option>
          {models.map((item) => <option key={item}>{item}</option>)}
          {brand && <option>Autre</option>}
        </select>
      </label>
    );
  }

  if (filter.type === "BOOLEAN") {
    return <label className={styles.toggleField}><span>{filter.label}</span><input type="checkbox" /></label>;
  }

  if (filter.type === "SELECT") {
    return (
      <label className={styles.field}>
        <span>{filter.label}{filter.required ? " *" : ""}</span>
        <select defaultValue=""><option value="">Sélectionner</option>{filter.options?.map((option) => <option key={option}>{option}</option>)}</select>
      </label>
    );
  }

  if (filter.type === "MULTISELECT") {
    return <fieldset className={styles.multiField}><legend>{filter.label}</legend><div>{filter.options?.map((option) => <label key={option}><input type="checkbox" /> {option}</label>)}</div></fieldset>;
  }

  return (
    <label className={styles.field}>
      <span>{filter.label}{filter.required ? " *" : ""}</span>
      <div className={styles.inputWithUnit}>
        <input type={filter.type === "DATE" ? "date" : filter.type === "NUMBER" ? "number" : "text"} />
        {filter.unit && <i>{filter.unit}</i>}
      </div>
    </label>
  );
}

export function CatalogBrowser() {
  const [rootSlug, setRootSlug] = useState(catalog[0]?.slug ?? "");
  const [childSlug, setChildSlug] = useState(catalog[0]?.children?.[0]?.slug ?? "");
  const [brand, setBrand] = useState("");
  const root = useMemo(() => catalog.find((item) => item.slug === rootSlug) ?? catalog[0], [rootSlug]);
  const child = root?.children?.find((item) => item.slug === childSlug) ?? root?.children?.[0];

  function selectRoot(category: CatalogCategory) {
    setRootSlug(category.slug);
    setChildSlug(category.children?.[0]?.slug ?? "");
    setBrand("");
  }

  function selectChild(slug: string) {
    setChildSlug(slug);
    setBrand("");
  }

  return (
    <div className={styles.browser}>
      <div className={styles.roots}>
        {catalog.map((category) => (
          <button type="button" key={category.slug} className={category.slug === root?.slug ? styles.activeRoot : styles.root} onClick={() => selectRoot(category)}>
            <span>{category.icon ?? "•"}</span><b>{category.name}</b><small>{category.description ?? `${category.children?.length ?? 0} sous-catégories`}</small>
          </button>
        ))}
      </div>

      <div className={styles.content}>
        <div>
          <p className={styles.kicker}>Sous-catégorie</p><h3>{root?.name}</h3>
          <div className={styles.children}>
            {root?.children?.map((category) => (
              <button type="button" key={category.slug} onClick={() => selectChild(category.slug)} className={category.slug === child?.slug ? styles.activeChild : styles.child}>
                {category.name}<span>›</span>
              </button>
            ))}
          </div>
        </div>

        <aside className={styles.preview}>
          <p className={styles.kicker}>Formulaire dynamique</p><h3>{child?.name ?? "Choisissez une catégorie"}</h3>
          <p className={styles.muted}>Les champs ci-dessous sont réellement générés à partir de la catégorie sélectionnée.</p>
          <div className={styles.dynamicForm}>
            {(child?.filters ?? []).map((filter) => <DynamicField key={filter.key} filter={filter} categorySlug={child?.slug ?? ""} brand={brand} onBrandChange={setBrand} />)}
          </div>

          {child?.domain === "REAL_ESTATE" && <fieldset className={styles.multiField}><legend>Équipements & prestations</legend><div>{propertyExtras.map((item) => <label key={item}><input type="checkbox" /> {item}</label>)}</div></fieldset>}
          {child?.domain === "VEHICLE" && <div className={styles.notice}>Plaque FR → pré-remplissage fournisseur agréé, puis validation manuelle.</div>}
          {child?.domain === "REAL_ESTATE" && <div className={styles.notice}>DPE + GES + caractéristiques du bien intégrés au même parcours.</div>}
          {child?.domain === "ANIMAL" && <div className={styles.notice}>Identification et informations réglementaires adaptés à l’animal.</div>}
        </aside>
      </div>
    </div>
  );
}
