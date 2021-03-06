
require('dotenv').config();
const { Scenes, Markup } = require('telegraf');
let DOMAIN_ROOT = process.env.DOMAIN_ROOT;
const fs = require('fs');
const superBotHelper = require('../botHelpers/superBotHelpers');
const { BotApi } = require('../apiinterfaces/ApartmentApi');

function convertApartmentIdsForPriceButton(ctx, apartmentIds) {
    // интервал цен
    const priceContainer = {
        ['0-2500']: [],
        ['2500-3000']: [],
        ['3000-4000']: [],
        ['4000-5000']: [],
        ['5000']: []
    };

    apartmentIds.forEach(async (apartmentId, index) => {

        let { data } = await ctx.session.telBotApiService.getApartmentsByIds([apartmentId]);
        // !расскоментировать
        // let { data } = await apartmentApiInstance.getApartmentsByIds([apartmentId]);
        if (data && data.apartments) {
            let curApartment = data.apartments[0] || {};
            for (let priceKey in priceContainer) {
                if (priceKey == '5000') {
                    if (parseInt(curApartment.price) > 5000) {
                        priceContainer['5000'].push(curApartment);
                    }
                } else {
                    let [from, to] = priceKey.split('-');
                    let fromPrice = parseInt(from);
                    let toPrice = parseInt(to);
                    let apartPrice = parseInt(curApartment.price);
                    if (fromPrice <= apartPrice && apartPrice < toPrice) {
                        priceContainer[priceKey].push(curApartment);
                    }
                }
            }
        }
        if (index == apartmentIds.length - 1) {
            // createPriceButtons(priceContainer);
            await ctx.reply('Укажите цену по которой вы бы хотели приобрести квартиру');
            let buttons = [];
            for (let key in priceContainer) {
                if (priceContainer[key].length > 0) {// если квартиры тут есть
                    let apartmentIds = priceContainer[key].map((item) => item.id).join(':');
                    console.log({ apartmentIds })
                    buttons.push([{
                        text: `Цена: ${key}`,
                        callback_data: JSON.stringify({ type: 'press_price', value: apartmentIds })
                    }]);
                }
            }
            await ctx.reply('Доступные цены', Markup.inlineKeyboard(buttons));
        }
    });
}

/** 
 * ! вот такой интерфейс должен иметь пришедший объект
 * !interface IroomsAmountAndIds {
 * ! [key: roomsAmount]: value : [apartmentsIds]
 * !}
 */
function createRoomsAmountButton(roomsAmountAndIds) {
    let roomsButtons = Object.keys(roomsAmountAndIds).map((roomsAmount) => {
        let roomsIdsStr = roomsAmountAndIds[roomsAmount].join(':');
        return [{
            text: roomsAmount,
            callback_data: JSON.stringify({ type: "press_room_amount", value: `${roomsAmount}:${roomsIdsStr}` })
        }];
    });
    return roomsButtons;
}
// на вход принимает массив id квартир
function createApartmentButtonWithCertainAmountOfRooms(apartments) {
    try {
        const inlineApartmentKeyBoard = apartments.map((room) => {
            return [{
                text: room.address, callback_data: JSON.stringify({
                    type: 'create_order',
                    value: room.id,
                })
            }];
        });
        return inlineApartmentKeyBoard;
    } catch (e) {
        return [];
    }
}

const WizardScene = Scenes.WizardScene;
const subwayAndOrderWizzard = new WizardScene(
    "subway_and_order", // Имя сцены
    (ctx) => {
        if (isButtonPressed(ctx)) {// нажали на кнопку с определенным метро
            let dataStr = JSON.parse(ctx.update.callback_query.data) || {
                type: 'error'
            };
            chooseSubwayButtonHandler(ctx, dataStr);
            // обрабатываем данные в случае успеха переходим дальше
        } else {
            superBotHelper.startCommands.subwayStart(ctx);
        }
    },

    async (ctx) => {
        if (isButtonPressed(ctx)) {// нажали на кнопку с определенным метро
            let data = JSON.parse(ctx.update.callback_query.data) || {
                type: 'error'
            };
            chooseAmountOfRoomsButton(ctx, data);
        } else {
            ctx.reply('Пожалуйста выберите сколько комнат должно быть в квартире');
            await showRoomAmountButtons(ctx, ctx.session.roomsAmountResponseData);
            ctx.wizard.back();
        }
    },
    (ctx) => {
        if (isButtonPressed(ctx)) {
            ctx.reply('Выберите квартиру из списка ниже');
            let data = JSON.parse(ctx.update.callback_query.data) || {
                type: 'error'
            };
            choosePriceIntervalButton(ctx, data);
        } else {
            ctx.reply('Пожалуйста выберите цену по которой хотели бы купить квартиру');
            convertApartmentIdsForPriceButton(ctx, ctx.session.apartmentIdsForPrices);
        }
    }
);

function isButtonPressed(ctx) {
    return ctx.update && ctx.update.callback_query;
}
async function choosePriceIntervalButton(ctx, data) {
    let { type, value } = data;
    if (type !== 'press_price') {
        ctx.wizard.back();
        ctx.reply('Что-то пошло не так ');
        return;
    }
    let apartmentIds = value.split(':');
    let response = await ctx.session.telBotApiService.getApartmentsByIds(apartmentIds);
    if (response.data && response.data.status === 'ok') {
        showApartmentsMessage(ctx, response.data);
    } else {
        ctx.reply('Произошла серверная ошибка извините');
    }
}

//! value это строка "roomAmount:apartmen1Id:apartmen2Id" первый аргумент это количество комнат остальные это id этих квартир 
async function chooseAmountOfRoomsButton(ctx, data) {
    let { type, value } = data;
    if (type !== 'press_room_amount') {
        ctx.reply('что-то пошло не так');
        ctx.scene.leave();
    }
    let [amountOfRoom, ...apartmentIds] = value.split(':');
    // цены в интервалах 
    ctx.session.apartmentIdsForPrices = apartmentIds;
    convertApartmentIdsForPriceButton(ctx, apartmentIds);
    ctx.reply('вы выбрали количество комнат');
    await ctx.wizard.next();
}
async function chooseSubwayButtonHandler(ctx, data) {
    // ! value  это id выбранного метро
    let { type, value } = data;
    if (!(type == 'choose_subway')) {
        ctx.reply('Что-то пошло не так');
        return ctx.scene.leave();
    }
    ctx.session.subwayId = value;
    // делаем запрос на получение квартир с таким метро и возвращаем кнопки
    if (!ctx.session.telBotApiService) {
        ctx.session.telBotApiService = new BotApi(process.env.TEL_BOT_API_KEY);
    }
    let maxPerson = ctx.session.personsAmount;
    let { data: responseData } = await ctx.session.telBotApiService.getApartmetnsWithBySubWayId(value, maxPerson);
    ctx.session.roomsAmountResponseData = responseData;
    showRoomAmountButtons(ctx, responseData);
}

async function showRoomAmountButtons(ctx, responseData) {
    if (responseData.status === 'ok') {
        try {
            let inlineKeyBoard = createRoomsAmountButton(responseData.roomsAmountWithApartmentsIds);
            ctx.reply('Выберите какое количество квартир вас интересует',
                Markup.inlineKeyboard(inlineKeyBoard));
            ctx.wizard.next();
        } catch (e) {
            console.log({ ERROR: e })
            ctx.reply('Произошла серверная ошибка');
        }
    } else {
        superBotHelper.deleteBotMessages(ctx);
        superBotHelper.startCommands.subwayStart(ctx);
        let info = await ctx.reply('Для данного метро нет ни одной квартиры просим прощения ');
        superBotHelper.saveBotMessageIdForDeleted(ctx, info.message_id);
    }
}

function showApartmentsMessage(ctx, data) {
    let { apartments } = data;
    const imageContainer = {};
    for (let ap of apartments) {
        if (ap.images && ap.images.length) {
            imageContainer[ap.id] = ap.images;
        }
    }
    let inlineKeyBoard = createApartmentButtonWithCertainAmountOfRooms(apartments);
    inlineKeyBoard.map(async (btn, i) => {
        let btnInfo = btn[0];
        let curApartmentId = JSON.parse(btnInfo.callback_data).value;
        // console.log({ allImages: imageContainer[curApartmentId] });
        let imageInfo = (curApartmentId in imageContainer) ? imageContainer[curApartmentId][0] : '/default/missy_kitty.jpg';
        // ctx.session.fromChatId
        try {
            let allImagesSend = imageContainer[curApartmentId].map((img) => {
                return {
                    type: 'photo',
                    media: DOMAIN_ROOT + img
                }
            });
            await ctx.session.curBot.telegram.sendMediaGroup(ctx.from.id, allImagesSend);
        } catch (e) {

        }


        let { data: curApartmentData } = await ctx.session.telBotApiService.getApartmentsByIds([curApartmentId]);
        let finalText = '';
        if (curApartmentData.status == 'ok') {
            let aparmtmentInstance = curApartmentData.apartments[0] || {};
            console.log({ aparmtmentInstance });
            finalText += '*адрес*:' + aparmtmentInstance.address + '\n';
            finalText += '*кол-во комнат*:' + aparmtmentInstance.roomAmount + '\n';
            finalText += '*цена*:' + aparmtmentInstance.price + '\n';
        }
        await ctx.replyWithPhoto({
            url: DOMAIN_ROOT + imageInfo
        }, { caption: finalText, parse_mode: 'markdown', ...Markup.inlineKeyboard([btn]) });
    });

    ctx.scene.enter('create_order');
    // раскоментировать!!!
    // ctx.reply('Вы выбрали квартиры с определенным кол-вом комнат', Markup.inlineKeyboard(inlineKeyBoard));
}

module.exports = {
    subwayAndOrderWizzard: subwayAndOrderWizzard
}