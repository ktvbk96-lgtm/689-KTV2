/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Helper to export/download the complete single-file standalone Index.html
 * for 689 KTV POS directly from the UI, ready for Google Apps Script deployment.
 */

export async function exportStandaloneHtmlFile(fileName: string = 'Index.html'): Promise<void> {
  try {
    let res = await fetch('/Index.html');
    if (!res.ok) {
      res = await fetch('/single_file_689ktv_pos.html');
    }
    if (!res.ok) {
      throw new Error(`Failed to load standalone HTML template (${res.status})`);
    }
    const htmlText = await res.text();
    const blob = new Blob([htmlText], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error('Error exporting standalone Index.html:', error);
    alert('ເກີດຂໍ້ຜິດພາດໃນການດາວໂຫລດ Index.html: ' + (error instanceof Error ? error.message : String(error)));
  }
}
