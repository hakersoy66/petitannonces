// Keep these patterns aligned with the API's listing-content-policy.ts checks.
const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const internationalPhonePattern = /(?:\+|00)\s*\d{1,3}(?:[\s().-]*\d){7,12}\b/;
const frenchPhonePattern = /\b0[1-9](?:[\s.-]*\d{2}){4}\b/;
const labelledPhonePattern = /(?:t[ée]l(?:[ée]phone)?|phone|whatsapp|contact)\s*[:=.-]?\s*(?:\+|00)?\s*\d(?:[\s().-]*\d){7,14}/i;

export function descriptionContactIssues(description: string) {
  return {
    email: emailPattern.test(description),
    phone: internationalPhonePattern.test(description) || frenchPhonePattern.test(description) || labelledPhonePattern.test(description),
  };
}

export function descriptionContactMessage(issues: { email: boolean; phone: boolean }) {
  if (issues.email && issues.phone) return "Retirez l’adresse e-mail et le numéro de téléphone de la description pour continuer. Utilisez la messagerie Petit Annonces pour échanger en toute sécurité.";
  if (issues.email) return "Retirez l’adresse e-mail de la description pour continuer. Les échanges doivent passer par la messagerie Petit Annonces.";
  if (issues.phone) return "Retirez le numéro de téléphone de la description pour continuer. Le contact avec le vendeur est disponible depuis l’annonce.";
  return "";
}
