/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Helper to export/download the complete single-file standalone index.html
 * for 689 KTV POS directly from the UI.
 */

export async function exportStandaloneHtmlFile(): Promise<void> {
  try {
    const res = await fetch('/single_file_689ktv_pos.html');
    if (!res.ok) {
      throw new Error(`Failed to load standalone HTML template (${res.status})`);
    }
    const htmlText = await res.text();
    const blob = new Blob([htmlText], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'index.html';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error('Error exporting standalone index.html:', error);
    alert('ເກີດຂໍ້ຜິດພາດໃນການດາວໂຫລດ index.html: ' + (error instanceof Error ? error.message : String(error)));
  }
}
