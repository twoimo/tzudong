import { HomeRuntimeShell } from '../home-runtime-shell';
import HomeClient from '../home-client';

export default function HomeFramePage() {
    return (
        <HomeRuntimeShell>
            <HomeClient />
        </HomeRuntimeShell>
    );
}
