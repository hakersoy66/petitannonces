import {useLocalSearchParams} from 'expo-router';
import {PwaAppShell} from '../../components/pwa-app-shell';
export default function PublishScreen(){
 const {id}=useLocalSearchParams<{id:string}>();
 return <PwaAppShell initialPath={id?'/deposer-une-annonce?listingId='+encodeURIComponent(id):'/deposer-une-annonce'}/>;
}
