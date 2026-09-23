import type { Metadata } from "next";
import { ListingCreateEntry } from "../../components/listing-create-entry";
import styles from "./page.module.css";

export const metadata:Metadata={title:"Déposer une annonce | Petit Annonces",description:"Créez une annonce étape par étape sur Petit Annonces."};
type Props={searchParams:Promise<{listingId?:string;mode?:string;resumeStep?:string;category?:string}>};

export default async function CreateListingPage({searchParams}:Props){
 const {listingId,mode,resumeStep,category}=await searchParams;
 return <div className={styles.page}><main className={styles.main}><div className={styles.shell}><ListingCreateEntry initialListingId={listingId} initialMode={mode} initialResumeStep={resumeStep?Number(resumeStep):undefined} initialCategorySlug={category}/></div></main></div>;
}
