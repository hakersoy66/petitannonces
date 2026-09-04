export default function BoutiquePage() {
  return (
    <main style={{minHeight:'70vh',display:'grid',placeItems:'center',padding:'40px 20px'}}>
      <section style={{maxWidth:720,textAlign:'center'}}>
        <p style={{fontWeight:800,color:'#5b4cf0'}}>Petit Annonces Pro</p>
        <h1 style={{fontSize:'clamp(2rem,5vw,4rem)',lineHeight:1,marginTop:12}}>Créez votre boutique professionnelle</h1>
        <p style={{marginTop:18,color:'#6c6c7d',lineHeight:1.7}}>Présentez vos annonces, développez votre visibilité et accédez aux outils dédiés aux vendeurs professionnels.</p>
        <a href="/inscription/pro" style={{display:'inline-flex',marginTop:26,padding:'14px 22px',borderRadius:999,background:'#5b4cf0',color:'#fff',fontWeight:800}}>Créer mon compte Pro</a>
      </section>
    </main>
  );
}
