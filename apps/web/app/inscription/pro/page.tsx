import {redirect} from "next/navigation";
const PLANS=new Set(["ESSENTIEL","PROFESSIONNEL","PREMIUM"]);
const one=(value?:string|string[])=>Array.isArray(value)?value[0]:value;
export default async function LegacyProSignup({searchParams}:{searchParams:Promise<{plan?:string|string[];ref?:string|string[]}>}){
 const q=await searchParams;
 const raw=one(q.plan);const plan=raw&&PLANS.has(raw)?raw:null;
 const ref=(one(q.ref)??"").trim().slice(0,40);
 const params=new URLSearchParams({type:"pro"});if(plan)params.set("plan",plan);if(ref)params.set("ref",ref);
 redirect(`/inscription?${params.toString()}`)
}
