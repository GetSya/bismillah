import { NextResponse } from 'next/server';
import TelegramBot from 'node-telegram-bot-api';
import { supabase } from '@/lib/supabase';

// ==================================================================
// 1. KONFIGURASI & INIT BOT
// ==================================================================
const token = process.env.TELEGRAM_BOT_TOKEN;
const bot = token ? new TelegramBot(token, { polling: false }) : null;

// Info Rekening untuk Tampilan Invoice
const BANK_INFO = {
    bank: "BCA",
    number: "1234-5678-9000",
    name: "STORE OFFICIAL"
};

// Konfigurasi Tampilan Keyboard
const MAX_BUTTONS_DISPLAY = 50;  // Maksimal produk yang punya tombol angka
const BUTTONS_PER_ROW = 6;       // 6 Kolak per baris (Agar rapi)

// ==================================================================
// 2. HELPER: MEMBUAT KEYBOARD DINAMIS
// ==================================================================
function createDynamicKeyboard(totalItems) {
    // Menu Tetap di Atas
    const topMenu = [
        { text: "🏷 List Produk" }, 
        { text: "🛍 Voucher" }, 
        { text: "📦 Laporan Stok" }
    ];

    // Menu Tetap di Bawah
    const bottomMenu = [
        { text: "💰 Deposit" }, 
        { text: "❓ Cara" }, 
        { text: "⚠️ Information" }
    ];

    // Menu Angka (Grid Tengah)
    const numberGrid = [];
    const count = Math.min(totalItems, MAX_BUTTONS_DISPLAY);

    if (count > 0) {
        let tempRow = [];
        for (let i = 1; i <= count; i++) {
            tempRow.push({ text: `${i}` });

            // Jika sudah 6 tombol, buat baris baru
            if (tempRow.length === BUTTONS_PER_ROW) {
                numberGrid.push(tempRow);
                tempRow = [];
            }
        }
        // Masukkan sisa tombol jika ada
        if (tempRow.length > 0) {
            numberGrid.push(tempRow);
        }
    }

    return {
        keyboard: [
            topMenu,
            ...numberGrid, // Spread operator untuk memasukkan grid angka
            bottomMenu
        ],
        resize_keyboard: true,
        is_persistent: true,
        input_field_placeholder: "Pilih menu atau nomor..."
    };
}


// ==================================================================
// 3. MAIN ROUTE HANDLER (WEBHOOK)
// ==================================================================
export async function POST(req) {
    if (!bot) return NextResponse.json({ error: 'Bot inactive' });

    try {
        const body = await req.json();

        // A. HANDLE TOMBOL INLINE (Checkout / Cancel)
        if (body.callback_query) {
            await handleCallbackQuery(body.callback_query);
        }
        // B. HANDLE PESAN TEKS (Menu / Angka)
        else if (body.message?.text) {
            await handleTextMessage(body.message);
        }
        // C. HANDLE GAMBAR (Bukti Transfer)
        else if (body.message?.photo) {
            await handlePhotoMessage(body.message);
        }

        return NextResponse.json({ status: 'ok' });
    } catch (error) {
        console.error('SERVER ERROR:', error);
        return NextResponse.json({ error: error.message });
    }
}


// ==================================================================
// 4. LOGIC CALLBACK QUERY (CHECKOUT & CANCEL)
// ==================================================================
async function handleCallbackQuery(query) {
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;
    const data = query.data;

    // Matikan indikator loading di tombol user
    await bot.answerCallbackQuery(query.id);

    // CASE 1: BATAL
    if (data === 'cancel') {
        // Hapus pesan detail produk
        await bot.deleteMessage(chatId, messageId);
    }
    // CASE 2: CHECKOUT (Membuat Order Pending)
    else if (data.startsWith('checkout_')) {
        const productId = data.split('_')[1];

        // Ambil info produk
        const { data: product } = await supabase
            .from('products')
            .select('*')
            .eq('id', productId)
            .single();

        if (!product) {
            return bot.sendMessage(chatId, "⚠️ Produk tidak ditemukan/terhapus.");
        }

        // INSERT ORDER KE DATABASE (Status: pending)
        const { data: order, error } = await supabase.from('orders').insert({
            user_id: chatId,
            product_id: productId,
            total_price: product.price,
            status: 'pending' // Pending = Belum ada bukti transfer
        }).select().single();

        if (error) {
            console.error("Order DB Error:", error);
            return bot.sendMessage(chatId, "❌ Gagal membuat pesanan.");
        }

        const price = new Intl.NumberFormat('id-ID').format(product.price);

        // UBAH PESAN MENJADI INVOICE
        const invoiceMsg = `
⚡️ <b>TAGIHAN PEMBAYARAN (#${order.id})</b>
────────────────────
📦 <b>Item:</b> ${product.name}
💰 <b>Total:</b> Rp ${price}
────────────────────

🏦 <b>REKENING PEMBAYARAN:</b>
<b>${BANK_INFO.bank}</b>
<code>${BANK_INFO.number}</code>
A.N ${BANK_INFO.name}

📸 <b>LANGKAH SELANJUTNYA:</b>
Status pesanan: <b>🟡 PENDING</b>.
Mohon segera <b>kirim FOTO BUKTI TRANSFER</b> di chat ini agar status berubah menjadi Verified.
`;

        await bot.editMessageText(invoiceMsg, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'HTML'
        });
    }
}


// ==================================================================
// 5. LOGIC TEXT MESSAGE (NAVIGATION & SELECTION)
// ==================================================================
async function handleTextMessage(msg) {
    const chatId = msg.chat.id;
    const text = msg.text;
    const user = msg.from;

    // A. Simpan/Update Data User
    await supabase.from('users').upsert({
        telegram_id: chatId,
        username: user.username,
        full_name: `${user.first_name || ''} ${user.last_name || ''}`.trim()
    });

    // B. Ambil Jumlah Stok (Untuk merender Keyboard)
    const { count } = await supabase
        .from('products')
        .select('*', { count: 'exact', head: true })
        .eq('is_active', true);

    const totalActive = count || 0;
    const dynamicKeyboard = createDynamicKeyboard(totalActive);

    // C. Jika Text adalah ANGKA (User memilih produk dari tombol bawah)
    if (/^\d+$/.test(text)) {
        await showProductDetail(chatId, parseInt(text), dynamicKeyboard);
        return; 
    }

    // D. Router Menu
    switch (text) {
        case '/start':
            await bot.sendMessage(chatId, `👋 <b>Halo, ${user.first_name}!</b>\nSelamat datang di Store Bot.\nSilakan tekan menu <b>List Produk</b> di bawah.`, { 
                parse_mode: 'HTML', 
                reply_markup: dynamicKeyboard 
            });
            break;

        case '🏷 List Produk':
            await sendProductList(chatId, dynamicKeyboard);
            break;

        case '🛍 Voucher':
            await bot.sendMessage(chatId, "🔐 Menu Voucher belum tersedia.", { 
                reply_markup: dynamicKeyboard 
            });
            break;

        case '📦 Laporan Stok':
            await bot.sendMessage(chatId, `📊 <b>Status Stok</b>\n\n🟢 Produk Ready: <b>${totalActive} Item</b>\n\n<i>Klik 'List Produk' untuk refresh.</i>`, { 
                parse_mode: 'HTML', 
                reply_markup: dynamicKeyboard 
            });
            break;

        case '💰 Deposit':
            await bot.sendMessage(chatId, "Silakan hubungi admin @UserAdmin untuk deposit saldo.", { 
                reply_markup: dynamicKeyboard 
            });
            break;

        case '❓ Cara':
            const tutorial = `
📚 <b>CARA ORDER:</b>
1. Klik menu <b>List Produk</b>
2. Lihat nomor pada produk yang diinginkan (Misal [1])
3. Tekan angka <b>1</b> pada tombol keyboard.
4. Klik 'Checkout Langsung'.
5. Transfer dan kirim bukti foto disini.
`;
            await bot.sendMessage(chatId, tutorial, { parse_mode: 'HTML', reply_markup: dynamicKeyboard });
            break;

        case '⚠️ Information':
            await bot.sendMessage(chatId, "Bot Store v2.0 - Fast Response 24 Jam.", { reply_markup: dynamicKeyboard });
            break;

        default:
            // Pesan default agar keyboard tidak hilang
            await bot.sendMessage(chatId, "Silakan pilih menu menggunakan tombol.", { 
                reply_markup: dynamicKeyboard 
            });
            break;
    }
}


// ==================================================================
// 6. HELPER FUNCTIONS: LIST & DETAIL
// ==================================================================

// MENAMPILKAN LIST PRODUK
async function sendProductList(chatId, kb) {
    // Ambil data (Max 50 agar muat di keyboard)
    const { data: products } = await supabase
        .from('products')
        .select('*')
        .eq('is_active', true)
        .order('price', { ascending: true }) // URUTAN SANGAT PENTING
        .limit(MAX_BUTTONS_DISPLAY);

    if (!products || products.length === 0) {
        return bot.sendMessage(chatId, "⚠️ Produk Kosong.", { reply_markup: kb });
    }

    let message = `🛒 <b>DAFTAR HARGA UPDATE</b>\n`;
    message += `<i>Gunakan tombol angka di bawah untuk membeli.</i>\n\n`;

    products.forEach((p, idx) => {
        const num = idx + 1;
        const price = new Intl.NumberFormat('id-ID').format(p.price);
        // Style List sesuai request (tanpa table ASCII biar cepat load di mobile, tapi rapi)
        message += `┊ [${num}] <b>${p.name.toUpperCase()}</b>\n`;
        message += `┊ ↳ Rp ${price}\n`;
        message += `┊ \n`;
    });

    message += `╰────────────────────◊`;

    await bot.sendMessage(chatId, message, { parse_mode: 'HTML', reply_markup: kb });
}

// MENAMPILKAN DETAIL + TOMBOL CHECKOUT
async function showProductDetail(chatId, selectedNumber, kb) {
    const { data: products } = await supabase
        .from('products')
        .select('*')
        .eq('is_active', true)
        .order('price', { ascending: true })
        .limit(MAX_BUTTONS_DISPLAY);
    
    // Convert nomor User (1,2,3) jadi Index Array (0,1,2)
    const index = selectedNumber - 1;

    // Validasi
    if (!products || !products[index]) {
        return bot.sendMessage(chatId, `⚠️ Produk nomor ${selectedNumber} tidak valid/berubah urutan. Silakan refresh List.`, { reply_markup: kb });
    }

    const item = products[index];
    const price = new Intl.NumberFormat('id-ID').format(item.price);

    const detailText = `
🛍 <b>DETAIL PRODUK</b>
➖➖➖➖➖➖➖➖➖➖
🏷 <b>${item.name.toUpperCase()}</b>
💰 <b>Rp ${price}</b>
➖➖➖➖➖➖➖➖➖➖

📄 <b>Deskripsi:</b>
${item.description || "Tidak ada keterangan."}

👇 <i>Apakah Anda yakin ingin membeli?</i>
`;

    const inlineButtons = {
        inline_keyboard: [
            [
                { text: "✅ Checkout Langsung", callback_data: `checkout_${item.id}` }
            ],
            [
                { text: "🏠 Kembali / Batal", callback_data: `cancel` } 
            ]
        ]
    };

    // Kirim pesan Detail
    await bot.sendMessage(chatId, detailText, {
        parse_mode: 'HTML',
        reply_markup: inlineButtons
    });
}


// ==================================================================
// 7. PHOTO HANDLER (UPLOAD CATBOX.MOE) -> STATUS VERIFICATION
// ==================================================================
async function handlePhotoMessage(msg) {
    const chatId = msg.chat.id;

    // 1. Cari Order milik user yang statusnya 'pending'
    const { data: order } = await supabase
        .from('orders')
        .select('*, products(name)')
        .eq('user_id', chatId)
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

    if (!order) {
        // Abaikan gambar jika tidak ada order pending (biar bot tidak spam respon kalau user kirim foto sembarangan)
        return bot.sendMessage(chatId, "❌ Tidak ada pesanan <b>Pending</b>.\nSilakan Checkout produk dulu sebelum kirim bukti.", {parse_mode:'HTML'});
    }

    const loadMsg = await bot.sendMessage(chatId, "⏳ <i>Sedang mengupload ke Catbox...</i>", {parse_mode:'HTML'});

    try {
        // 2. Ambil File dari Telegram
        const photo = msg.photo[msg.photo.length - 1]; // Resolusi paling besar
        const telegramFileLink = await bot.getFileLink(photo.file_id);
        
        // 3. Download dan Ubah ke Blob (Persiapan Upload Catbox)
        const response = await fetch(telegramFileLink);
        const arrayBuffer = await response.arrayBuffer();
        const imageBlob = new Blob([arrayBuffer], { type: 'image/jpeg' });

        // 4. Proses Upload ke API CATBOX
        const formData = new FormData();
        formData.append('reqtype', 'fileupload');
        formData.append('fileToUpload', imageBlob, `trx_${order.id}.jpg`);

        const catboxReq = await fetch('https://catbox.moe/user/api.php', {
            method: 'POST',
            body: formData
        });

        if (!catboxReq.ok) throw new Error("Gagal connect ke Catbox");

        // Response Catbox adalah text url plain (contoh: https://files.catbox.moe/xyz.jpg)
        const catboxUrl = await catboxReq.text(); 

        if (catboxUrl.includes('Error')) throw new Error(catboxUrl);

        // 5. UPDATE DATABASE (Status -> Verification)
        await supabase.from('orders').update({
            status: 'verification',
            payment_proof_url: catboxUrl
        }).eq('id', order.id);

        // 6. SUKSES - Kirim Konfirmasi
        await bot.deleteMessage(chatId, loadMsg.message_id);

        const successMsg = `
✅ <b>BUKTI DITERIMA!</b>
──────────────────────
🔗 <a href="${catboxUrl}">Lihat Bukti (Catbox)</a>

<b>Order ID:</b> #${order.id}
<b>Produk:</b> ${order.products?.name}
<b>Status Baru:</b> 🔵 VERIFICATION

Mohon tunggu, admin sedang memverifikasi pembayaran Anda.
Produk akan dikirim setelah status berubah menjadi Success.
`;
        await bot.sendMessage(chatId, successMsg, { 
            parse_mode: 'HTML',
            disable_web_page_preview: true // Agar link catbox tidak muncul preview besar
        });

    } catch (e) {
        console.error("Upload Failed:", e);
        await bot.deleteMessage(chatId, loadMsg.message_id);
        await bot.sendMessage(chatId, "⚠️ <b>Gagal Upload Bukti!</b>\nTerjadi kesalahan jaringan (Catbox Error). Silakan coba kirim fotonya lagi.", {parse_mode:'HTML'});
    }
}