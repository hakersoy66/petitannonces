import {useLocalSearchParams} from 'expo-router';
import {PwaAppShell} from '../components/pwa-app-shell';

function first(value:string|string[]|undefined){return Array.isArray(value)?value[0]:value}
export default function WebFeature(){
  const params=useLocalSearchParams<{path?:string|string[]}>();
  return <PwaAppShell initialPath={first(params.path)??'/'}/>;
}