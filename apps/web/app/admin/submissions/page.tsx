import { redirect } from 'next/navigation';

export default function AdminSubmissionsRedirect() {
    redirect('/admin/evaluations?view=submissions');
}
