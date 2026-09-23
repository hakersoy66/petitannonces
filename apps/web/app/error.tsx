"use client";
import {RecoveryErrorScreen} from "../components/recovery-error-screen";
export default function Error({reset}:{error:Error&{digest?:string};reset:()=>void}){return <RecoveryErrorScreen reset={reset}/>}