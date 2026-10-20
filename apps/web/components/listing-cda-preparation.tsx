"use client";

import { useEffect, useState, type FormEvent } from "react";
import styles from "./listing-cda-preparation.module.css";

type Operation = 1 | 2 | 3 | 4;
type OwnerType = 1 | 2;
type ProNumberType = 1 | 2 | 3 | 4;
type Status = "NOT_STARTED" | "PREPARED";
type CdaStatus = {
  status?: Status;
  verified?: boolean;
  officialVerificationAvailable?: boolean;
  preparedAt?: string;
  expiresAt?: string;
};
type Props = {
  listingId: string;
  categorySlug: string;
  isProfessional: boolean;
  onBack: () => void;
};
const api = () => (process.env.NEXT_PUBLIC_API_URL ?? "/api").replace(/\/$/, "");

export function ListingCdaPreparation({ listingId, categorySlug, isProfessional, onBack }: Props) {
  const canPrepare = categorySlug === "chiens" || categorySlug === "chats";
  const species = categorySlug === "chiens" ? 1 : 2;
  const [operation, setOperation] = useState<Operation>(isProfessional ? 3 : 1);
  const [ownerType, setOwnerType] = useState<OwnerType>(isProfessional ? 2 : 1);
  const [idMethod, setIdMethod] = useState<"chip" | "tattoo">("chip");
  const [identifier, setIdentifier] = useState("");
  const [sex, setSex] = useState<"M" | "F">("M");
  const [birthDate, setBirthDate] = useState("");
  const [pedigree, setPedigree] = useState(false);
  const [breed, setBreed] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [proType, setProType] = useState<ProNumberType>(1);
  const [proNumber, setProNumber] = useState("");
  const [femaleCount, setFemaleCount] = useState("0");
  const [litterCount, setLitterCount] = useState("0");
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [status, setStatus] = useState<Status>("NOT_STARTED");
  const [message, setMessage] = useState("");
  const [expiresAt, setExpiresAt] = useState("");

  useEffect(() => {
    setStatus("NOT_STARTED");
    setExpiresAt("");
    setChecking(true);
    setMessage("");
    if (!canPrepare || !listingId) { setChecking(false); return; }
    let canceled = false;
    void fetch(api() + "/listings/" + encodeURIComponent(listingId) + "/cda", {
      credentials: "include", cache: "no-store",
    }).then(async response => {
      if (!response.ok) throw Error("status_unavailable");
      return response.json() as Promise<CdaStatus>;
    }).then(data => {
      if (canceled) return;
      setStatus(data.status === "PREPARED" ? "PREPARED" : "NOT_STARTED");
      setExpiresAt(data.expiresAt ?? "");
    }).catch(() => {
      if (!canceled) setMessage("Le statut de préparation CDA n'a pas pu être chargé.");
    }).finally(() => { if (!canceled) setChecking(false); });
    return () => { canceled = true; };
  }, [canPrepare, listingId]);

  function changeOwner(next: OwnerType) {
    setOwnerType(next);
    setOperation(next === 1 ? 1 : 3);
    setMessage("");
  }

  async function prepare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading || !canPrepare || !listingId) return;
    setMessage("");
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(birthDate)) {
      setMessage("Renseignez le mois et l'année de naissance."); return;
    }
    if (new Date(birthDate + "-01") > new Date()) {
      setMessage("La date de naissance ne peut pas être dans le futur."); return;
    }
    const normalizedId = identifier.trim().toUpperCase();
    const pro = proNumber.trim().toUpperCase();
    if (ownerType === 2) {
      const valid = proType === 1 ? /^\d{14,15}$/.test(pro)
        : proType === 4 ? /^W\d{9}$/.test(pro)
        : /^[A-Z0-9]{6}$/.test(pro);
      if (!valid) { setMessage("Vérifiez le type et le numéro professionnel."); return; }
    }
    const owner = ownerType === 1
      ? { type: 1, firstName: firstName.trim(), lastName: lastName.trim() }
      : {
          type: 2, proNumberType: proType, proNumber: pro,
          ...(operation === 3 ? {
            numberOfBreedingFemale: Number(femaleCount),
            numberOfLitter: Number(litterCount),
          } : {}),
        };
    const body = {
      operationType: operation,
      data: {
        animal: {
          identification: idMethod === "chip"
            ? { isInsert: true, insert: normalizedId }
            : { isInsert: false, tatou: normalizedId },
          species, sex, birthDate, isLoofLof: pedigree, race: breed.trim(),
        },
        owner,
      },
    };
    setLoading(true);
    try {
      const response = await fetch(api() + "/listings/" + encodeURIComponent(listingId) + "/cda/prepare", {
        method: "POST", credentials: "include", cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => ({})) as {
        prepared?: boolean; expiresAt?: string; error?: string;
      };
      if (!response.ok || !payload.prepared) {
        const reason: Record<string,string> = {
          invalid_cda_data: "Certaines informations ne correspondent pas au format requis par I-CAD.",
          animal_species_category_mismatch: "L'espèce doit correspondre à la catégorie choisie.",
          professional_account_required: "Utilisez un compte professionnel pour ce type de cession.",
          rate_limited: "Trop de tentatives. Réessayez dans quelques minutes.",
          draft_not_found: "Le brouillon n'est plus disponible. Revenez à la catégorie.",
        };
        setMessage(reason[payload.error ?? ""] ?? "Enregistrement impossible pour le moment.");
        return;
      }
      // Discard the sensitive raw inputs from the interface after submission.
      setIdentifier(""); setFirstName(""); setLastName(""); setProNumber("");
      setBirthDate(""); setBreed("");
      setStatus("PREPARED");
      setExpiresAt(payload.expiresAt ?? "");
      setMessage("");
    } catch {
      setMessage("Le service de préparation est indisponible pour le moment.");
    } finally {
      setLoading(false);
    }
  }

  return <div className={styles.wrapper}>
    <div className={styles.head}>
      <div className={styles.icon} aria-hidden="true">🐾</div>
      <div>
        <span className={styles.eyebrow}>I-CAD · Contrôle des annonces</span>
        <h3>Préparation de la vérification animale</h3>
        <p>Identifiez l'animal et son détenteur avant toute demande de cession.</p>
      </div>
    </div>
    <div className={styles.notice} role="status">
      <strong>Fonctionnalité en préparation — aucune annonce d'animal vivant n'est publiable.</strong>
      <span>L'accès I-CAD actuel est réservé à la préproduction. L'enregistrement des données ci-dessous ne constitue <b>ni une validation officielle, ni une autorisation de vente, de don ou d'adoption</b>. Aucun code n'est envoyé à cette étape.</span>
    </div>
    {!canPrepare ? <div className={styles.notice}>
      Les vérifications CDA disponibles concernent uniquement les chiens et les chats. Les autres catégories restent indisponibles pour les cessions.
    </div> : checking ? <p className={styles.muted}>Vérification du statut du brouillon…</p> : status === "PREPARED" ? <div className={styles.confirmation}>
      <strong>Informations de préparation enregistrées</strong>
      <p>Les données ont été enregistrées sous forme d'empreinte sécurisée liée à votre brouillon. Votre identité et celle de l'animal ne sont pas certifiées par I-CAD.</p>
      {expiresAt && <small>Préparation valable jusqu'au {new Date(expiresAt).toLocaleDateString("fr-FR")}. Une vérification officielle sera exigée avant toute publication.</small>}
      <button type="button" className={styles.secondary} onClick={() => setStatus("NOT_STARTED")}>Recommencer la préparation</button>
    </div> : <form className={styles.form} onSubmit={prepare} autoComplete="off">
      <section className={styles.section}>
        <div className={styles.sectionTitle}><span>01</span><div><h4>Nature de la cession</h4><p>Le type de compte et l'opération doivent respecter les règles I-CAD.</p></div></div>
        <div className={styles.grid}>
          <label className={styles.field}><span>Statut du détenteur</span>
            <select value={ownerType} onChange={event => changeOwner(Number(event.target.value) as OwnerType)}>
              <option value={1}>Particulier (don uniquement)</option>
              {isProfessional && <option value={2}>Professionnel / association</option>}
            </select>
          </label>
          <label className={styles.field}><span>Type de cession</span>
            <select value={operation} onChange={event => setOperation(Number(event.target.value) as Operation)}>
              {ownerType === 1 ? <option value={1}>Don par un particulier</option> : <>
                <option value={2}>Don par un professionnel</option>
                <option value={3}>Vente professionnelle</option>
                <option value={4}>Adoption par une association</option>
              </>}
            </select>
          </label>
        </div>
      </section>
      <section className={styles.section}>
        <div className={styles.sectionTitle}><span>02</span><div><h4>Identification de {species === 1 ? "votre chien" : "votre chat"}</h4><p>Les informations doivent correspondre au fichier national I-CAD.</p></div></div>
        <div className={styles.grid}>
          <label className={styles.field}><span>Identification *</span>
            <select value={idMethod} onChange={event => { setIdMethod(event.target.value as "chip" | "tattoo"); setIdentifier(""); }}>
              <option value="chip">Puce électronique</option><option value="tattoo">Tatouage</option>
            </select>
          </label>
          <label className={styles.field}><span>Numéro de {idMethod === "chip" ? "puce" : "tatouage"} *</span>
            <input required maxLength={30} minLength={idMethod === "chip" ? 8 : 4} value={identifier} onChange={event => setIdentifier(event.target.value)} placeholder={idMethod === "chip" ? "Ex. 250000000000000" : "Numéro d'identification"} autoCapitalize="characters" autoCorrect="off" spellCheck={false}/>
          </label>
          <label className={styles.field}><span>Sexe *</span>
            <select value={sex} onChange={event => setSex(event.target.value as "M" | "F")}><option value="M">Mâle</option><option value="F">Femelle</option></select>
          </label>
          <label className={styles.field}><span>Naissance (année et mois) *</span>
            <input type="month" required value={birthDate} onChange={event => setBirthDate(event.target.value)} max={new Date().toISOString().slice(0,7)}/>
          </label>
          <label className={styles.field + " " + styles.full}><span>Race enregistrée *</span>
            <input required maxLength={120} value={breed} onChange={event => setBreed(event.target.value)} placeholder="Race exacte telle qu'enregistrée chez I-CAD" />
          </label>
          <label className={styles.checkbox}><input type="checkbox" checked={pedigree} onChange={event => setPedigree(event.target.checked)}/><span>Animal inscrit au LOF ou LOOF</span></label>
        </div>
      </section>
      <section className={styles.section}>
        <div className={styles.sectionTitle}><span>03</span><div><h4>Identité du détenteur</h4><p>Renseignez le détenteur figurant dans le registre officiel.</p></div></div>
        <div className={styles.grid}>
          {ownerType === 1 ? <>
            <label className={styles.field}><span>Prénom *</span><input required maxLength={100} value={firstName} onChange={event => setFirstName(event.target.value)}/></label>
            <label className={styles.field}><span>Nom *</span><input required maxLength={100} value={lastName} onChange={event => setLastName(event.target.value)}/></label>
          </> : <>
            <label className={styles.field}><span>Type de numéro professionnel *</span>
              <select value={proType} onChange={event => setProType(Number(event.target.value) as ProNumberType)}>
                <option value={1}>SIRET</option><option value={2}>Éleveur LOF</option>
                <option value={3}>Éleveur LOOF</option><option value={4}>RNA (association)</option>
              </select>
            </label>
            <label className={styles.field}><span>Numéro déclaré *</span>
              <input required maxLength={15} value={proNumber} onChange={event => setProNumber(event.target.value)} placeholder={proType === 1 ? "14 chiffres" : proType === 4 ? "W + 9 chiffres" : "Numéro éleveur"}/>
            </label>
            {operation === 3 && <>
              <label className={styles.field}><span>Femelles reproductrices (année précédente) *</span>
                <input type="number" min={0} max={100000} required value={femaleCount} onChange={event => setFemaleCount(event.target.value)}/>
              </label>
              <label className={styles.field}><span>Portées (année précédente) *</span>
                <input type="number" min={0} max={100000} required value={litterCount} onChange={event => setLitterCount(event.target.value)}/>
              </label>
            </>}
          </>}
        </div>
      </section>
      <p className={styles.privacy}>Ces informations servent uniquement à préparer le contrôle futur. La préparation est limitée à ce brouillon et ne sauvegarde pas le numéro d'identification ni le nom du détenteur en clair.</p>
      {message && <p className={styles.error} role="alert">{message}</p>}
      <button className={styles.submit} type="submit" disabled={loading}>{loading ? "Enregistrement…" : "Enregistrer la préparation CDA"}</button>
    </form>}
    <div className={styles.actions}>
      <button type="button" className={styles.secondary} onClick={onBack}>Retour aux photos</button>
      <span>La publication restera bloquée jusqu'à l'autorisation officielle I-CAD.</span>
    </div>
  </div>;
}
