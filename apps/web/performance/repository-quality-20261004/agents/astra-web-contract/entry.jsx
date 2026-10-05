import React from 'react';
import { createRoot } from 'react-dom/client';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '../../../components/ui/dialog';
import { AlertDialog, AlertDialogContent, AlertDialogTitle, AlertDialogDescription, AlertDialogCancel } from '../../../components/ui/alert-dialog';
const params = new URLSearchParams(location.search);
const wider = params.get('wide') === '1';
const alert = params.get('kind') === 'alert';
const Root = alert ? AlertDialog : Dialog;
const Content = alert ? AlertDialogContent : DialogContent;
const Title = alert ? AlertDialogTitle : DialogTitle;
const Description = alert ? AlertDialogDescription : DialogDescription;
function App() {
 const [open,setOpen] = React.useState(true);
 return <Root open={open} onOpenChange={setOpen}><Content className={wider ? 'max-w-2xl' : undefined}>
  <Title>화면 여백 검사</Title><Description>로컬 모달 검증용 고정 문장입니다.</Description>
  {alert ? <AlertDialogCancel>닫기</AlertDialogCancel> : <button>키보드 탐색 확인</button>}
 </Content></Root>;
}
createRoot(document.getElementById('root')).render(<App/>);
