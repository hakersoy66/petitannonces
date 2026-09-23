export type AppIconName = string;

export function AppIcon({name,className,title}:{name:AppIconName;className?:string;title?:string}){
  const glyph=name==="plus"?"＋":name==="check"||name==="circle-check"?"✓":name==="search"?"⌕":name==="heart"?"♡":name==="bell"?"◌":name==="arrow-left"||name==="chevron-left"?"‹":name==="arrow-right"||name==="chevron-right"?"›":name==="chevron-down"?"⌄":"•";
  return <span className={className} title={title} aria-hidden={title?undefined:true}>{glyph}</span>;
}
