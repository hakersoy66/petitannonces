"use client";

const COUNT_KEY="paScrollLockCount";
const ORIGINAL_KEY="paScrollOriginalOverflow";
let activeLocks=0;

function count(body:HTMLElement){
  const value=Number(body.dataset[COUNT_KEY]);
  return Number.isFinite(value)&&value>0?Math.floor(value):0;
}

function clearStaleState(body:HTMLElement){
  delete body.dataset[COUNT_KEY];
  delete body.dataset[ORIGINAL_KEY];
  if(body.style.overflow==="hidden")body.style.overflow="";
}

export function lockBodyScroll(){
  if(typeof document==="undefined")return()=>{};
  const body=document.body;
  if(activeLocks===0&&count(body)>0)clearStaleState(body);
  if(activeLocks===0)body.dataset[ORIGINAL_KEY]=body.style.overflow==="hidden"?"":body.style.overflow;
  activeLocks+=1;
  body.dataset[COUNT_KEY]=String(activeLocks);
  body.style.overflow="hidden";
  let released=false;
  return()=>{
    if(released||typeof document==="undefined")return;
    released=true;
    activeLocks=Math.max(0,activeLocks-1);
    const target=document.body;
    if(activeLocks>0){target.dataset[COUNT_KEY]=String(activeLocks);return;}
    const original=target.dataset[ORIGINAL_KEY]??"";
    delete target.dataset[COUNT_KEY];
    delete target.dataset[ORIGINAL_KEY];
    target.style.overflow=original;
  };
}

export function healStaleBodyScrollLock(){
  if(typeof document==="undefined")return;
  const body=document.body;
  if(activeLocks>0){
    body.dataset[COUNT_KEY]=String(activeLocks);
    body.style.overflow="hidden";
    return;
  }
  clearStaleState(body);
}
