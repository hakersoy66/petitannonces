export default function ListingLoading(){
  const pulse={background:"linear-gradient(90deg,#f0eff5 25%,#f7f6fa 37%,#f0eff5 63%)",backgroundSize:"400% 100%",borderRadius:12} as const;
  return <main style={{width:"min(1180px,calc(100% - 20px))",margin:"0 auto",padding:"14px 0 150px"}} aria-label="Chargement de l’annonce">
    <div style={{...pulse,height:12,width:"42%",marginBottom:12}}/>
    <div style={{...pulse,height:"min(72vw,430px)",minHeight:240,borderRadius:18}}/>
    <div style={{display:"grid",gridTemplateColumns:"1fr 120px",gap:12,alignItems:"end",marginTop:16}}><div><div style={{...pulse,height:18,width:"76%"}}/><div style={{...pulse,height:13,width:"48%",marginTop:9}}/></div><div style={{...pulse,height:30}}/></div>
    <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:8,marginTop:18}}>{[1,2,3,4].map(i=><div key={i} style={{...pulse,height:72}}/>)}</div>
    <div style={{...pulse,height:120,marginTop:12}}/>
    <div style={{...pulse,height:118,marginTop:12}}/>
  </main>
}
