import { NextResponse } from 'next/server';
import TelegramBot from 'node-telegram-bot-api';
import { supabase } from '@/lib/supabase';

// ==================================================================
// 1. KONFIGURASI BOT
// ==================================================================
const token = process.env.TELEGRAM_BOT_TOKEN;
const bot = token ? new TelegramBot(token, { polling: false }) : null;

const MAX_BUTTONS_DISPLAY = 50;
const BUTTONS_PER_ROW = 6;


// ==================================================================
// 2. HELPER: CREATE DYNAMIC KEYBOARD
// ==================================================================
function createDynamicKeyboard(totalItems) {
    const topMenu = [
        { text: "🏷 List Produk" }, { text: "🛍 Voucher" }, { text: "📦 Laporan Stok" }
    ];

    const bottomMenu = [
        { text: "💰 Deposit" }, { text: "❓ Cara" }, { text: "⚠️ Information" }
    ];

    const numberGrid = [];
    const count = Math.min(totalItems, MAX_BUTTONS_DISPLAY);

    if (count > 0) {
        let row = [];
        for (let i = 1; i <= count; i++) {
            row.push({ text: `${i}` });

            if (row.length === BUTTONS_PER_ROW) {
                numberGrid.push(row);
                row = [];
            }
        }
        if (row.length > 0) numberGrid.push(row);
    }

    return {
        keyboard: [
            topMenu,
            ...numberGrid,
            bottomMenu
        ],
        resize_keyboard: true,
        is_persistent: true
    };
}


// ==================================================================
// 3. GET STORE SETTINGS (logo, welcome message, etc.)
// ==================================================================
async function getSetting(key) {
    const { data } = await supabase
        .from('store_settings')
        .select('setting_value')
        .eq('setting_key', key)
        .single();

    return data?.setting_value || null;
}


// ==================================================================
// 4. MAIN ROUTE HANDLER
// ==================================================================
export async function POST(req) {
    if (!bot) return NextResponse.json({ error: 'Bot inactive' });

    try {
        const body = await req.json();

        if (body.callback_query) {
            await handleCallbackQuery(body.callback_query);
        } else if (body.message?.text) {
            await handleTextMessage(body.message);
        } else if (body.message?.photo) {
            await handlePhotoMessage(body.message);
        }

        return NextResponse.json({ status: 'ok' });
    } catch (e) {
        console.error('SERVER ERROR:', e);
        return NextResponse.json({ error: e.message });
    }
}


// ==================================================================
// 5. CALLBACK QUERY HANDLER (CHECKOUT VARIAN)
// ==================================================================
async function handleCallbackQuery(query) {
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;
    const data = query.data;

    await bot.answerCallbackQuery(query.id);

    if (data === "cancel") {
        return bot.deleteMessage(chatId, messageId);
    }

    if (data.startsWith("checkout_")) {
        const parts = data.split("_");

        const productId = parts[1];
        const variantIndex = parseInt(parts[2] || "0");

        // Ambil produk
        const { data: product } = await supabase
            .from("products")
            .select("*")
            .eq("id", productId)
            .single();

        if (!product) {
            return bot.sendMessage(chatId, "⚠️ Produk tidak ditemukan.");
        }

        // Tentukan varian
        let finalPrice = product.price;
        let variantName = product.unit || "Default";

        if (product.variants?.length > 0) {
            const v = product.variants[variantIndex];
            finalPrice = v.price;
            variantName = v.name;
        }

        // Insert order
        const { data: order } = await supabase.from("orders").insert({
            user_id: chatId,
            product_id: productId,
            total_price: finalPrice,
            variant_name: variantName,
            status: "pending"
        }).select().single();

        const price = new Intl.NumberFormat("id-ID").format(finalPrice);

        const invoice = `
⚡️ <b>TAGIHAN PEMBAYARAN (#${order.id})</b>
────────────────────
📦 <b>Produk:</b> ${product.name}
🔢 <b>Varian:</b> ${variantName}
💰 <b>Total:</b> Rp ${price}
────────────────────

📸 Silakan kirim foto bukti transfer.
`;

        await bot.editMessageText(invoice, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: "HTML"
        });
    }
}


// ==================================================================
// 6. TEXT MESSAGE HANDLER
// ==================================================================
async function handleTextMessage(msg) {
    const chatId = msg.chat.id;
    const text = msg.text;
    const user = msg.from;

    // Save user
    await supabase.from("users").upsert({
        telegram_id: chatId,
        username: user.username,
        full_name: `${user.first_name || ""} ${user.last_name || ""}`.trim()
    });

    const { count } = await supabase
        .from("products")
        .select("*", { count: "exact", head: true })
        .eq("is_active", true);

    const dynamicKeyboard = createDynamicKeyboard(count || 0);

    // Jika user menekan angka
    if (/^\d+$/.test(text)) {
        return showProductDetail(chatId, parseInt(text), dynamicKeyboard);
    }

    // ROUTER MENU
    switch (text) {
        case "/start": {
            const logo = await getSetting("welcome_logo_url");
            const message = await getSetting("welcome_message");

            const caption = message
                ? message.replace("{name}", user.first_name)
                : `👋 Halo ${user.first_name}!`;

            if (logo) {
                await bot.sendPhoto(chatId, logo, {
                    caption,
                    parse_mode: "HTML",
                    reply_markup: dynamicKeyboard
                });
            } else {
                await bot.sendMessage(chatId, caption, {
                    parse_mode: "HTML",
                    reply_markup: dynamicKeyboard
                });
            }
            break;
        }

        case "🏷 List Produk":
            await sendProductList(chatId, dynamicKeyboard);
            break;

        case "📦 Laporan Stok":
            await bot.sendMessage(chatId, `📊 Stok Aktif: ${count} item`, {
                parse_mode: "HTML",
                reply_markup: dynamicKeyboard
            });
            break;

        case "❓ Cara":
            await bot.sendMessage(chatId, `
📚 <b>CARA ORDER:</b>
1. Klik <b>List Produk</b>
2. Pilih nomor produk
3. Pilih varian
4. Checkout
5. Transfer & Kirim bukti
            `, {
                parse_mode: "HTML",
                reply_markup: dynamicKeyboard
            });
            break;

        default:
            await bot.sendMessage(chatId, "Gunakan tombol untuk navigasi.", {
                reply_markup: dynamicKeyboard
            });
    }
}



// ==================================================================
// 7. SEND PRODUCT LIST (Support Varian)
// ==================================================================
async function sendProductList(chatId, kb) {
    const { data: products } = await supabase
        .from("products")
        .select("*")
        .eq("is_active", true);

    if (!products?.length) {
        return bot.sendMessage(chatId, "⚠️ Produk kosong.", { reply_markup: kb });
    }

    let msg = `🛒 <b>DAFTAR PRODUK</b>\n\n`;

    products.forEach((p, i) => {
        let basePrice = p.price;

        if (p.variants?.length > 0) {
            const sorted = [...p.variants].sort((a, b) => a.price - b.price);
            basePrice = sorted[0].price;
        }

        const price = new Intl.NumberFormat("id-ID").format(basePrice);

        msg += `┊ [${i + 1}] <b>${p.name.toUpperCase()}</b>\n`;
        msg += `┊ ↳ Mulai Rp ${price}\n\n`;
    });

    await bot.sendMessage(chatId, msg, { parse_mode: "HTML", reply_markup: kb });
}



// ==================================================================
// 8. SHOW PRODUCT DETAIL (Support Varian)
// ==================================================================
async function showProductDetail(chatId, selectedNumber, kb) {
    const { data: products } = await supabase
        .from("products")
        .select("*")
        .eq("is_active", true);

    const index = selectedNumber - 1;

    if (!products || !products[index]) {
        return bot.sendMessage(chatId, "Produk tidak ditemukan.", { reply_markup: kb });
    }

    const item = products[index];

    let variantText = "";
    const buttons = [];

    if (item.variants?.length > 0) {
        variantText += "<b>Pilih Varian:</b>\n";

        item.variants.forEach((v, idx) => {
            const price = new Intl.NumberFormat("id-ID").format(v.price);
            variantText += `┊ ${idx + 1}. ${v.name} — Rp ${price}\n`;

            buttons.push([
                {
                    text: `${v.name} (${price})`,
                    callback_data: `checkout_${item.id}_${idx}`
                }
            ]);
        });
    } else {
        const price = new Intl.NumberFormat("id-ID").format(item.price);
        variantText += `💰 <b>Harga:</b> Rp ${price}`;

        buttons.push([
            {
                text: `Checkout Rp ${price}`,
                callback_data: `checkout_${item.id}_0`
            }
        ]);
    }

    buttons.push([{ text: "🏠 Kembali", callback_data: "cancel" }]);

    const message = `
🛍 <b>DETAIL PRODUK</b>
➖➖➖➖➖➖➖➖
🏷 <b>${item.name}</b>

${variantText}

📄 <b>Deskripsi:</b>
${item.description || "Tidak ada deskripsi."}
`;

    await bot.sendMessage(chatId, message, {
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: buttons }
    });
}



// ==================================================================
// 9. PHOTO HANDLER (UPLOAD BUKTI BAYAR)
// ==================================================================
async function handlePhotoMessage(msg) {
    const chatId = msg.chat.id;

    // Ambil order pending terbaru
    const { data: order } = await supabase
        .from("orders")
        .select("*, products(name)")
        .eq("user_id", chatId)
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

    if (!order) {
        return bot.sendMessage(chatId, "⚠️ Tidak ada order pending.", {
            parse_mode: "HTML"
        });
    }

    const loading = await bot.sendMessage(chatId, "⏳ Uploading bukti...");

    try {
        const photo = msg.photo[msg.photo.length - 1];
        const fileUrl = await bot.getFileLink(photo.file_id);

        const res = await fetch(fileUrl);
        const arrayBuffer = await res.arrayBuffer();
        const blob = new Blob([arrayBuffer], { type: "image/jpeg" });

        const form = new FormData();
        form.append("reqtype", "fileupload");
        form.append("fileToUpload", blob, `trx_${order.id}.jpg`);

        const upload = await fetch("https://catbox.moe/user/api.php", {
            method: "POST",
            body: form
        });

        const link = await upload.text();

        await supabase.from("orders").update({
            status: "verification",
            payment_proof_url: link
        }).eq("id", order.id);

        await bot.deleteMessage(chatId, loading.message_id);

        await bot.sendMessage(chatId, `
✅ <b>Bukti diterima!</b>
<b>Order ID:</b> #${order.id}
<b>Status:</b> VERIFICATION
🔗 <a href="${link}">Lihat Bukti</a>
        `, { parse_mode: "HTML" });

    } catch (e) {
        console.error(e);
        await bot.deleteMessage(chatId, loading.message_id);
        await bot.sendMessage(chatId, "⚠️ Gagal upload bukti.");
    }
}
