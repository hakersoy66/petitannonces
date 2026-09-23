"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import styles from "./catalog-filter-panel.module.css";
import { lockBodyScroll } from "../lib/body-scroll-lock";

const api=()=> (process.env.NEXT_PUBLIC_API_URL??"/api").replace(/\/$/,"");
type CategoryNode={name:string;slug:string;children?:CategoryNode[]};
type FilterOption={value:string;label:string;count?:number};
type FilterAttribute={key:string;label:string;type:"TEXT"|"NUMBER"|"SELECT"|"MULTISELECT"|"BOOLEAN"|"DATE";unit:string|null;options:FilterOption[];min?:number;max?:number;dependsOn?:string};
type FilterPayload={attributes?:FilterAttribute[];priceRange?:{min:number|null;max:number|null;count:number}};
type NumericRange={min:string;max:string};
const EMPTY_CATEGORY_TREE:CategoryNode[]=[];
const EMPTY_ATTRIBUTES:FilterAttribute[]=[];
const EMPTY_PRICE_RANGE={min:null,max:null,count:0};
const EMPTY_ATTRIBUTE_VALUES:Record<string,string>={};
const EMPTY_ATTRIBUTE_RANGES:Record<string,NumericRange>={};
type Props={category?:string;city?:string;minPrice?:string;maxPrice?:string;q?:string;sort?:string;radiusKm?:string;near?:string;view?:"list"|"map";initialCategoryTree?:CategoryNode[];initialAttributes?:FilterAttribute[];initialPriceRange?:{min:number|null;max:number|null;count:number};initialAttributeValues?:Record<string,string>;initialAttributeRanges?:Record<string,NumericRange>};
function flatten(nodes:CategoryNode[],depth=0):Array<{name:string;slug:string;depth:number}>{return nodes.flatMap(node=>[{name:node.name,slug:node.slug,depth},...flatten(node.children??[],depth+1)])}
function cleanNumber(value:number|undefined){return value==null||!Number.isFinite(value)?"":new Intl.NumberFormat("fr-FR",{maximumFractionDigits:1}).format(value)}

export function CatalogFilterPanel({category="",city="",minPrice="",maxPrice="",q="",sort="",radiusKm="",near="",view="list",initialCategoryTree=EMPTY_CATEGORY_TREE,initialAttributes=EMPTY_ATTRIBUTES,initialPriceRange=EMPTY_PRICE_RANGE,initialAttributeValues=EMPTY_ATTRIBUTE_VALUES,initialAttributeRanges=EMPTY_ATTRIBUTE_RANGES}:Props) {
  const [open,setOpen]=useState(false);
  const [selectedCategory,setSelectedCategory]=useState(category);
  const [categoryTree,setCategoryTree]=useState<CategoryNode[]>(initialCategoryTree);
  const [attributes,setAttributes]=useState<FilterAttribute[]>(initialAttributes);
  const [priceRange,setPriceRange]=useState<{min:number|null;max:number|null;count:number}>(initialPriceRange);
  const [attributeValues,setAttributeValues]=useState<Record<string,string>>(initialAttributeValues);
  const [attributeRanges,setAttributeRanges]=useState<Record<string,NumericRange>>(initialAttributeRanges);
  const [cityValue,setCityValue]=useState(city);
  const [minPriceValue,setMinPriceValue]=useState(minPrice);
  const [maxPriceValue,setMaxPriceValue]=useState(maxPrice);
  const [radiusValue,setRadiusValue]=useState(radiusKm);
  const [nearValue,setNearValue]=useState(near);
  const [facetsLoading,setFacetsLoading]=useState(false);
  const categoryOptions=useMemo(()=>flatten(categoryTree),[categoryTree]);
  const selectedBrand=attributeValues.brand??"";
  const skipInitialFacets=useRef(Boolean(category&&initialAttributes.length));

  useEffect(()=>{if(initialCategoryTree.length){setCategoryTree(initialCategoryTree);return}fetch(`${api()}/categories/tree`,{credentials:"include"}).then(r=>r.ok?r.json():Promise.reject()).then(p=>setCategoryTree(p.categories??[])).catch(()=>setCategoryTree([]))},[initialCategoryTree]);
  useEffect(()=>{
    setAttributeValues(initialAttributeValues);setAttributeRanges(initialAttributeRanges);setSelectedCategory(category);setCityValue(city);setMinPriceValue(minPrice);setMaxPriceValue(maxPrice);setRadiusValue(radiusKm);setNearValue(near);
  },[category,city,minPrice,maxPrice,radiusKm,near,initialAttributeValues,initialAttributeRanges]);
  useEffect(()=>{
    if(!selectedCategory){setAttributes([]);setPriceRange({min:null,max:null,count:0});return}
    if(skipInitialFacets.current){skipInitialFacets.current=false;return}
    let cancelled=false;setFacetsLoading(true);
    const qs=new URLSearchParams();if(selectedBrand)qs.set("brand",selectedBrand);
    fetch(`${api()}/categories/${encodeURIComponent(selectedCategory)}/filter-attributes${qs.size?`?${qs.toString()}`:""}`,{credentials:"include"})
      .then(r=>r.ok?r.json():Promise.reject())
      .then((p:FilterPayload)=>{if(cancelled)return;setAttributes((p.attributes??[]).filter(a=>a.key&&a.label).slice(0,18));setPriceRange(p.priceRange??{min:null,max:null,count:0})})
      .catch(()=>{if(!cancelled){setAttributes([]);setPriceRange({min:null,max:null,count:0})}})
      .finally(()=>{if(!cancelled)setFacetsLoading(false)});
    return()=>{cancelled=true};
  },[selectedCategory,selectedBrand]);
  useEffect(()=>{
    if(!open)return;
    const unlock=lockBodyScroll();
    const onKey=(event:KeyboardEvent)=>{if(event.key==="Escape")setOpen(false)};
    window.addEventListener("keydown",onKey);
    return()=>{unlock();window.removeEventListener("keydown",onKey)};
  },[open]);

  const quickPriceValues=useMemo(()=>{
    const max=priceRange.max??0;if(max>0&&max<=200)return[25,50,100];if(max>0&&max<=1200)return[100,250,500];if(max>0&&max<=10000)return[500,1000,5000];return[1000,5000,10000];
  },[priceRange.max]);
  const activeCount=useMemo(()=>{
    let n=0;if(cityValue)n++;if(minPriceValue)n++;if(maxPriceValue)n++;if(radiusValue)n++;
    n+=Object.values(attributeValues).filter(Boolean).length;
    n+=Object.values(attributeRanges).filter(r=>r.min||r.max).length;
    return n;
  },[cityValue,minPriceValue,maxPriceValue,radiusValue,attributeValues,attributeRanges]);
  function setAttr(key:string,value:string){setAttributeValues(current=>{const next={...current,[key]:value};if(key==="brand")next.model="";return next})}
  function setRange(key:string,side:keyof NumericRange,value:string){setAttributeRanges(current=>({...current,[key]:{...(current[key]??{min:"",max:""}),[side]:value}}))}

  return <aside className={styles.wrap}>
    <button type="button" className={styles.mobileToggle} onClick={()=>setOpen(v=>!v)} aria-expanded={open}><span>Filtres{activeCount>0&&<em>{activeCount}</em>}</span><b>{open?"Fermer":"Afficher"}</b></button>
    {open&&<button type="button" className={styles.backdrop} aria-label="Fermer les filtres" onClick={()=>setOpen(false)}/>}
    <form action="/recherche" method="get" className={`${styles.panel} ${open?styles.open:""}`} data-no-pull-refresh>
      {q&&<input type="hidden" name="q" value={q}/>}
      {sort&&<input type="hidden" name="sort" value={sort}/>}
      {view==="map"&&<input type="hidden" name="view" value="map"/>}
      {nearValue&&<input type="hidden" name="near" value={nearValue}/>}
      <div className={styles.head}><div><span>Filtres</span><small>{facetsLoading?"Mise à jour des choix…":"Affinez les résultats"}</small></div><a href={selectedCategory?`/recherche?category=${encodeURIComponent(selectedCategory)}`:"/recherche"}>Réinitialiser</a></div>
      <label className={styles.field}><span>Catégorie</span><select name="category" value={selectedCategory} onChange={e=>{setSelectedCategory(e.target.value);setAttributeValues({});setAttributeRanges({})}}><option value="">Toutes les catégories</option>{categoryOptions.map(item=><option value={item.slug} key={item.slug}>{`${item.depth?`${"— ".repeat(Math.min(item.depth,2))}`:""}${item.name}`}</option>)}</select></label>

      <div className={styles.quickFilters}><span>Filtres rapides</span><div>{quickPriceValues.map(value=><button type="button" key={`price-${value}`} className={maxPriceValue===String(value)?styles.quickActive:""} onClick={()=>setMaxPriceValue(maxPriceValue===String(value)?"":String(value))}>≤ {value.toLocaleString("fr-FR")} €</button>)}{cityValue.trim()&&[10,25,50].map(value=><button type="button" key={`radius-${value}`} className={radiusValue===String(value)?styles.quickActive:""} onClick={()=>setRadiusValue(radiusValue===String(value)?"":String(value))}>{value} km</button>)}</div></div>

      <div className={styles.priceGrid}><label className={styles.field}><span>Prix min.</span><input name="minPrice" type="number" min="0" step="1" value={minPriceValue} onChange={e=>setMinPriceValue(e.target.value)} placeholder={priceRange.min!=null?`${cleanNumber(priceRange.min)} €`:"0 €"}/></label><label className={styles.field}><span>Prix max.</span><input name="maxPrice" type="number" min="0" step="1" value={maxPriceValue} onChange={e=>setMaxPriceValue(e.target.value)} placeholder={priceRange.max!=null?`${cleanNumber(priceRange.max)} €`:"Max"}/></label></div>
      <label className={styles.field}><span>Ville ou code postal</span><input name="city" value={cityValue} onChange={e=>{setCityValue(e.target.value);setNearValue("");if(!e.target.value.trim())setRadiusValue("")}} placeholder="Ex. Lyon ou 69000"/></label>
      <label className={styles.field}><span>Rayon</span><select name="radiusKm" value={radiusValue} onChange={e=>setRadiusValue(e.target.value)} disabled={!cityValue.trim()}><option value="">Ville uniquement</option><option value="5">5 km</option><option value="10">10 km</option><option value="25">25 km</option><option value="50">50 km</option><option value="100">100 km</option><option value="200">200 km</option></select>{!cityValue.trim()&&<small className={styles.helper}>Saisissez une ville ou un code postal pour activer la recherche autour.</small>}</label>

      {attributes.length>0&&<div className={styles.dynamicFilters}><div className={styles.dynamicTitle}><b>Caractéristiques</b><small>{attributes.length} filtres adaptés</small></div>{attributes.map(attr=>{
        const value=attributeValues[attr.key]??"";const range=attributeRanges[attr.key]??{min:"",max:""};const dependencyMissing=Boolean(attr.dependsOn&&!attributeValues[attr.dependsOn]);
        if(attr.type==="NUMBER")return <div className={styles.numberFilter} key={attr.key}><span>{attr.label}{attr.unit?` · ${attr.unit}`:""}</span><div className={styles.rangeGrid}><input name={`attr_${attr.key}_min`} type="number" step="any" value={range.min} onChange={e=>setRange(attr.key,"min",e.target.value)} placeholder={attr.min!=null?`Min. ${cleanNumber(attr.min)}`:"Min."}/><input name={`attr_${attr.key}_max`} type="number" step="any" value={range.max} onChange={e=>setRange(attr.key,"max",e.target.value)} placeholder={attr.max!=null?`Max. ${cleanNumber(attr.max)}`:"Max."}/></div></div>;
        if((attr.type==="SELECT"||attr.type==="MULTISELECT"||((attr.key==="brand"||attr.key==="model")&&attr.options.length))&&attr.options.length)return <label className={styles.field} key={attr.key}><span>{attr.label}{attr.unit?` · ${attr.unit}`:""}</span><select name={`attr_${attr.key}`} value={value} disabled={dependencyMissing} onChange={e=>setAttr(attr.key,e.target.value)}><option value="">{dependencyMissing?"Choisissez d’abord une marque":"Tous"}</option>{attr.options.map(o=><option value={o.value} key={o.value} disabled={o.count===0&&value!==o.value}>{o.label}{o.count!==undefined?` (${o.count})`:""}</option>)}</select></label>;
        if(attr.type==="BOOLEAN")return <label className={styles.field} key={attr.key}><span>{attr.label}</span><select name={`attr_${attr.key}`} value={value} onChange={e=>setAttr(attr.key,e.target.value)}><option value="">Tous</option>{(attr.options.length?attr.options:[{value:"true",label:"Oui"},{value:"false",label:"Non"}]).map(o=><option key={o.value} value={o.value} disabled={o.count===0&&value!==o.value}>{o.label}{o.count!==undefined?` (${o.count})`:""}</option>)}</select></label>;
        return <label className={styles.field} key={attr.key}><span>{attr.label}{attr.unit?` · ${attr.unit}`:""}</span><input name={`attr_${attr.key}`} type={attr.type==="DATE"?"date":"text"} value={value} onChange={e=>setAttr(attr.key,e.target.value)} placeholder={attr.type==="TEXT"?`Ex. ${attr.label}`:undefined}/></label>;
      })}</div>}
      <button className={styles.apply} type="submit">Afficher les résultats</button>
    </form>
  </aside>;
}
