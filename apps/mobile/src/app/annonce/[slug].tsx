import {useLocalSearchParams} from 'expo-router';
import {PwaAppShell} from '../../components/pwa-app-shell';
export default function ListingDetailScreen(){
 const {slug}=useLocalSearchParams<{slug:string}>();
 return <PwaAppShell initialPath={slug?'/annonce/'+encodeURIComponent(slug):'/recherche'}/>;
}
