import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

const DEFAULT_KEY_FILE="/var/www/petitannonces/shared/image-fingerprint.key";
const CODE_BYTES=10;
const COLS=24;
const ROWS=18;
const REPEATS=2;
const V2_REPEATS=5;

let cachedSecret:string|null|undefined;

export function imageFingerprintSecret(){
  if(cachedSecret!==undefined)return cachedSecret;
  const env=process.env.IMAGE_FINGERPRINT_KEY?.trim();
  if(env){cachedSecret=env;return cachedSecret}
  try{
    const file=process.env.IMAGE_FINGERPRINT_KEY_FILE?.trim()||DEFAULT_KEY_FILE;
    const value=readFileSync(file,"utf8").trim();
    cachedSecret=value.length>=32?value:null;
  }catch{cachedSecret=null}
  return cachedSecret;
}

function hmac(secret:string,value:string){
  return createHmac("sha256",secret).update(value).digest();
}

function codeBits(secret:string,mediaId:string,listingId:string,version:number){
  const code=hmac(secret,`pa-image-fingerprint:v${version}:${mediaId}:${listingId}`).subarray(0,CODE_BYTES);
  const bits:number[]=[];
  for(const byte of code)for(let shift=7;shift>=0;shift--)bits.push((byte>>shift)&1);
  return bits;
}

function seededIndexes(secret:string,width:number,height:number,version:number,count:number){
  const cells=Array.from({length:COLS*ROWS},(_,index)=>index);
  let counter=0,pool=Buffer.alloc(0),offset=0;
  const next=()=>{
    if(offset+4>pool.length){pool=hmac(secret,version>=2?`pa-fp-pos:v${version}:${counter++}`:`pa-fp-pos:v${version}:${width}x${height}:${counter++}`);offset=0}
    const value=pool.readUInt32BE(offset);offset+=4;return value/0xffffffff;
  };
  for(let i=cells.length-1;i>0;i--){const j=Math.floor(next()*(i+1));[cells[i],cells[j]]=[cells[j]!,cells[i]!]}
  return cells.slice(0,Math.min(count,cells.length));
}

function applyPatch(data:Buffer,width:number,height:number,channels:number,cx:number,cy:number,radius:number,delta:number){
  for(let y=Math.max(0,cy-radius);y<=Math.min(height-1,cy+radius);y++){
    for(let x=Math.max(0,cx-radius);x<=Math.min(width-1,cx+radius);x++){
      const dx=Math.abs(x-cx),dy=Math.abs(y-cy);
      const weight=1-(Math.max(dx,dy)/(radius+1))*.35;
      const d=Math.round(delta*weight);
      const i=(y*width+x)*channels;
      if(channels<3)continue;
      const lum=.299*data[i]!+.587*data[i+1]!+.114*data[i+2]!;
      if(lum<24||lum>232)continue;
      data[i]=Math.max(0,Math.min(255,data[i]!+d));
      data[i+1]=Math.max(0,Math.min(255,data[i+1]!+d));
      data[i+2]=Math.max(0,Math.min(255,data[i+2]!+d));
    }
  }
}

function patchMean(data:Buffer,width:number,height:number,channels:number,cx:number,cy:number,radius:number){
  let total=0,count=0;
  for(let y=Math.max(0,cy-radius);y<=Math.min(height-1,cy+radius);y++)for(let x=Math.max(0,cx-radius);x<=Math.min(width-1,cx+radius);x++){
    const i=(y*width+x)*channels;if(channels<3)continue;
    total+=.299*data[i]!+.587*data[i+1]!+.114*data[i+2]!;count++;
  }
  return count?total/count:0;
}

function embedV2(data:Buffer,width:number,height:number,channels:number,bits:number[],secret:string,version:number,strength:number){
  const cells=seededIndexes(secret,width,height,version,bits.length*V2_REPEATS);
  if(cells.length<bits.length*V2_REPEATS)return data;
  const marginX=Math.round(width*.06),marginY=Math.round(height*.07),usableW=Math.max(1,width-marginX*2),usableH=Math.max(1,height-marginY*2);
  const cellW=usableW/COLS,cellH=usableH/ROWS,radius=Math.max(1,Math.min(4,Math.floor(Math.min(cellW,cellH)*.14))),offset=Math.max(radius+2,Math.floor(cellW*.18));
  const delta=Math.max(4,Math.min(12,Math.round(strength*4)));
  let cursor=0;
  for(const bit of bits)for(let repeat=0;repeat<V2_REPEATS;repeat++){
    const cell=cells[cursor++]!,col=cell%COLS,row=Math.floor(cell/COLS),cx=Math.round(marginX+(col+.5)*cellW),cy=Math.round(marginY+(row+.5)*cellH);
    applyPatch(data,width,height,channels,cx-offset,cy,radius,bit?delta:-delta);applyPatch(data,width,height,channels,cx+offset,cy,radius,bit?-delta:delta);
  }
  return data;
}

export function embedInvisibleFingerprint(args:{
  data:Buffer;width:number;height:number;channels:number;
  mediaId:string;listingId:string;secret:string;strength:number;version:number;
}){
  const {data,width,height,channels,mediaId,listingId,secret}=args;
  if(width<220||height<180||channels<3||!secret)return data;
  const version=Math.max(1,Math.floor(args.version||1));
  const strength=Math.max(1,Math.min(4,Math.round(args.strength||2)));
  const bits=codeBits(secret,mediaId,listingId,version);
  if(version>=2)return embedV2(data,width,height,channels,bits,secret,version,strength);
  const needed=bits.length*REPEATS*2;
  const cells=seededIndexes(secret,width,height,version,needed);
  if(cells.length<needed)return data;
  const marginX=Math.round(width*.06),marginY=Math.round(height*.07);
  const usableW=Math.max(1,width-marginX*2),usableH=Math.max(1,height-marginY*2);
  const cellW=usableW/COLS,cellH=usableH/ROWS;
  const radius=Math.max(2,Math.min(6,Math.floor(Math.min(cellW,cellH)*.22)));
  let cursor=0;
  for(const bit of bits){
    for(let repeat=0;repeat<REPEATS;repeat++){
      const pair=[cells[cursor++]!,cells[cursor++]!];
      for(let side=0;side<2;side++){
        const cell=pair[side]!,col=cell%COLS,row=Math.floor(cell/COLS);
        const cx=Math.round(marginX+(col+.5)*cellW),cy=Math.round(marginY+(row+.5)*cellH);
        const positive=(bit===1&&side===0)||(bit===0&&side===1);
        applyPatch(data,width,height,channels,cx,cy,radius,positive?strength:-strength);
      }
    }
  }
  return data;
}

export function expectedFingerprintBits(secret:string,mediaId:string,listingId:string,version:number){
  return codeBits(secret,mediaId,listingId,Math.max(1,Math.floor(version||1)));
}

export function observeInvisibleFingerprint(args:{data:Buffer;width:number;height:number;channels:number;secret:string;version:number}){
  const {data,width,height,channels,secret}=args;
  const version=Math.max(2,Math.floor(args.version||2));
  const bitCount=CODE_BYTES*8;
  const cells=seededIndexes(secret,width,height,version,bitCount*V2_REPEATS);
  if(width<220||height<180||channels<3||!secret||cells.length<bitCount*V2_REPEATS)return{bits:[] as number[],signal:0,scores:[] as number[]};
  const marginX=Math.round(width*.06),marginY=Math.round(height*.07),usableW=Math.max(1,width-marginX*2),usableH=Math.max(1,height-marginY*2);
  const cellW=usableW/COLS,cellH=usableH/ROWS,radius=Math.max(1,Math.min(4,Math.floor(Math.min(cellW,cellH)*.14))),offset=Math.max(radius+2,Math.floor(cellW*.18));
  const bits:number[]=[],scores:number[]=[];let cursor=0;
  for(let bitIndex=0;bitIndex<bitCount;bitIndex++){
    let total=0;
    for(let repeat=0;repeat<V2_REPEATS;repeat++){
      const cell=cells[cursor++]!,col=cell%COLS,row=Math.floor(cell/COLS),cx=Math.round(marginX+(col+.5)*cellW),cy=Math.round(marginY+(row+.5)*cellH);
      total+=patchMean(data,width,height,channels,cx-offset,cy,radius)-patchMean(data,width,height,channels,cx+offset,cy,radius);
    }
    const score=total/V2_REPEATS;scores.push(score);bits.push(score>=0?1:0);
  }
  const avg=scores.reduce((sum,value)=>sum+Math.abs(value),0)/Math.max(1,scores.length);
  return{bits,scores,signal:Math.max(0,Math.min(1,avg/5))};
}

export function compareFingerprintBits(observed:number[],expected:number[]){
  const total=Math.min(observed.length,expected.length);if(!total)return{matches:0,total:0,matchRate:0};
  let matches=0;for(let i=0;i<total;i++)if(observed[i]===expected[i])matches++;
  return{matches,total,matchRate:matches/total};
}
