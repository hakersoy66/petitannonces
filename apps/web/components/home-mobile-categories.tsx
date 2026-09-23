import { AppIcon, type AppIconName } from "./app-icon";

type Category={id:string;name:string;slug:string;domain:string};

function icon(category:Category):AppIconName{
 const slug=category.slug.toLowerCase();
 if(category.domain==="VEHICLE"||slug.includes("vehicule"))return "car";
 if(category.domain==="REAL_ESTATE"||slug.includes("immobilier"))return "home";
 if(category.domain==="JOB"||slug.includes("emploi"))return "briefcase";
 if(category.domain==="SERVICE"||slug.includes("service"))return "tools";
 if(category.domain==="ANIMAL"||slug.includes("anim"))return "paw";
 if(slug.includes("vacance"))return "calendar";
 if(slug.includes("high")||slug.includes("teleph")||slug.includes("informat"))return "laptop";
 if(slug.includes("maison")||slug.includes("jardin"))return "couch";
 if(slug.includes("mode"))return "shirt";
 if(slug.includes("sport"))return "football";
 if(slug.includes("enfant"))return "child";
 return "list";
}

const CATEGORY_PRIORITY=["vehicules","immobilier","vacances","high-tech","mode","emploi","maison-jardin","services","enfants-bebe","animaux"] as const;
function sortCategories(categories:Category[]){
 const rank=new Map<string,number>(CATEGORY_PRIORITY.map((slug,index)=>[slug,index]));
 return [...categories].sort((a,b)=>{
  const ar=rank.has(a.slug)?rank.get(a.slug)!:999; const br=rank.has(b.slug)?rank.get(b.slug)!:999;
  if(ar!==br)return ar-br; return a.name.localeCompare(b.name,"fr");
 });
}

export function HomeMobileCategories({categories}:{categories:Category[]}){
 if(!categories.length)return null;
 const visible=sortCategories(categories).slice(0,9);
 return <nav className="home-mobile-categories" aria-label="Catégories principales" data-no-pull-refresh>
  {visible.map(category=><a href={category.slug==="vacances"?"/vacances":`/categorie/${category.slug}`} key={category.id}><span className="home-mobile-category-icon"><AppIcon name={icon(category)}/></span><span>{category.name}</span></a>)}
  <a className="home-mobile-category-more" href="/recherche"><span className="home-mobile-category-icon"><AppIcon name="grip"/></span><span>Plus</span></a>
 </nav>;
}
