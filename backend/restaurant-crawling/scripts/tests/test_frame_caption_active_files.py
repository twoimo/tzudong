import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
import ast
import re


class FrameCaptionActiveFiles(unittest.TestCase):
    def test_hidden_history_and_staging_never_enter_caption_input(self):
        source=Path(__file__).resolve().parents[1]/'06-frame-caption.py'
        # Compile the actual lightweight file-selection functions without
        # importing the optional GPU/Pillow caption runtime.
        tree=ast.parse(source.read_text());names={'frame_sort_key','list_frame_files','get_frame_paths'}
        selected=ast.Module(body=[node for node in tree.body if isinstance(node,ast.FunctionDef) and node.name in names],type_ignores=[])
        scope={'Path':Path,'re':re,'os':os};exec(compile(selected,str(source),'exec'),scope)
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            paths=['frame_1.jpg','jpg/360p_1.0fps/frame_2.jpg','jpg/360p_1.0fps/.history/old/frame_1.jpg','.frames-staging/frame_3.png','.superseded/frame_4.webp']
            for name in paths:
                path=root/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(b'synthetic image')
            result=scope['list_frame_files'](root)
            self.assertEqual(result,[(root/paths[0]).resolve(),(root/paths[1]).resolve()])
            self.assertEqual(scope['get_frame_paths'](root),[str(value) for value in result])


if __name__=='__main__':unittest.main()
