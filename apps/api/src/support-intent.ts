export function normalizeSupportText(value:string){
 return value.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLocaleLowerCase("fr-FR").replace(/[^a-z0-9]+/g," ").trim();
}
export type SupportIntent="renewal"|"import"|"ambiguous"|null;
export function classifySupportIntent(category:string,subject:string,body:string):SupportIntent{
 if(!["LISTING","OTHER"].includes(category))return null;
 const text=normalizeSupportText(subject+" "+body);
 const item=/\b(?:annonces?|articles?|objets?|produits?|jouets?)\b/.test(text);
 const renewal=/\b(?:prolong\w*|renouvel\w*|renouvell\w*|expir\w*|republi\w*)\b/.test(text);
 const importing=/\b(?:import\w*|leboncoin|vinted|csv|flux xml|flux json)\b/.test(text);
 const competing=/\b(?:litige|arnaque|fraude|rembours\w*|livraison|colis|reservation|abonnement|suspend\w*|bloqu\w*|prelev\w*|debit\w*|factur\w*|icad|i cad)\b/.test(text);
 const renewalIssue=/\b(?:ne fonctionne pas|impossible|erreur|ne peux pas|n arrive pas|n apparait pas|pas disponible|ne vois pas)\b/.test(text);
 if((renewal||importing)&&competing)return "ambiguous";
 if(renewal&&importing)return "ambiguous";
 if(renewal&&(item||category==="LISTING")){
   if(renewalIssue)return "ambiguous";
   return "renewal";
 }
 if(importing&&(item||category==="LISTING"))return renewalIssue?"ambiguous":"import";
 return null;
}
export const RENEWAL_GUIDANCE="Pour prolonger une annonce, connectez-vous à votre compte puis ouvrez Mon compte > Mes annonces : https://petitannonces.fr/mon-compte/annonces. Le bouton de prolongation est disponible dans les 72 heures précédant l’expiration d’une annonce publiée, ou après son expiration lorsque l’option est proposée. Le premier renouvellement de 30 jours est gratuit ; les renouvellements suivants coûtent 0,99 € pour 30 jours, sauf avantage prévu par votre formule professionnelle. Les vérifications et les limites applicables à votre compte restent obligatoires.";
const stop=new Set("bonjour salut merci cordialement comment pourquoi quand quelle quelles quel quels faire peux peut puis pour avec dans depuis votre vos notre nous vous suis est sont une des les ces mes mon ma ses son sur par pas que qui dont avoir etre petit annonces annonce article articles plateforme compte".split(" "));
function tokens(v:string){return [...new Set(normalizeSupportText(v).split(" ").filter(w=>w.length>=4&&!stop.has(w)))];}
export function selectCuratedFaq<T extends {id:string;question:string;answer:string}>(rows:T[],subject:string,body:string):T|null{
 const query=normalizeSupportText(subject+" "+body);
 const user=new Set(tokens(subject+" "+body));
 const scored=rows.filter(x=>x.id.startsWith("faq-seed-")).map(x=>{
  const question=tokens(x.question);
  const hits=question.filter(w=>user.has(w)).length;
  const exact=normalizeSupportText(x.question);
  return {x,score:exact.length>=15&&query.includes(exact)?100:hits>=2&&hits/question.length>=0.75&&hits/user.size>=0.5?hits:0};
 }).sort((a,b)=>b.score-a.score);
 const top=scored[0];return top&&top.score>0&&(!scored[1]||top.score>scored[1].score)?top.x:null;
}
