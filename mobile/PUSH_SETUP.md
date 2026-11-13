# Push-уведомления «Цифрового Агронома» (Android / iPhone)

**Статус:** код, защищённые таблицы и две Edge Functions уже созданы в Supabase. Установлены pg_cron и pg_net; ежедневное задание создано, но **не отправляет запросы, пока нет секретного ключа в Vault**. Для реальной доставки требуется подключить Firebase (Android) и Apple APNs (iPhone). Без внешних ключей сборка приложения может работать, но push не придут.

## Что отправляется

- **Просроченные задачи:** если `due_date` раньше сегодняшней даты, а статус не `Выполнено`.
- **Обращения:** если `incident_date` старше трёх календарных дней, а статус не `Решено`.
- Получатели: **назначенный исполнитель** задачи или **автор** обращения и **все администраторы**. На одного сотрудника и один объект — не чаще раза в сутки на каждое зарегистрированное устройство.
- Тексты уведомлений не раскрывают внутренние комментарии или детали обращений на заблокированном телефоне.
- Проверка ежедневно в **10:00 МСК** (SQL cron: `0 7 * * *`, UTC).
- Нажатие на push переводит в соответствующий раздел CRM.

Кнопка включения: **Мобильное приложение → Ещё → Уведомления на телефон → Включить уведомления**. Разрешение запрашивается только после нажатия. При выходе через меню «Ещё» устройство удаляется из списка подписок.

## 1. Подключить Android / Firebase

1. На https://console.firebase.google.com создайте проект Firebase (или используйте существующий), добавьте **Android app** с package name `ru.digitalagronom.support`.
2. Скачайте **`google-services.json`** из настроек Android-приложения Firebase.
3. В GitHub откройте **Settings → Secrets and variables → Actions → New repository secret**. Имя: **`FIREBASE_ANDROID_CONFIG_BASE64`**. Значение — содержимое `google-services.json`, закодированное в Base64.
   - Windows PowerShell: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\\path\\to\\google-services.json"))`.
   - В GitHub Actions перед сборкой значение будет записано в `mobile/android/app/google-services.json`.
4. В настройках Firebase Project Settings → Service accounts создайте **новый служебный ключ** для Firebase Admin SDK (JSON) и сохраните его **только** в Supabase Dashboard → Edge Functions → Secrets, имя **`FCM_SERVICE_ACCOUNT_JSON`** (весь JSON в одной переменной).
5. Пересоберите Android APK через GitHub Actions. В установленном приложении авторизуйтесь и разрешите уведомления.

**Не путайте** `google-services.json` (конфигурация клиентского приложения) и служебный Firebase Admin SDK JSON (закрытый ключ): **закрытый ключ не добавлять в GitHub**.

## 2. Подключить iPhone / Apple APNs

Нужна платная программа Apple Developer; **iOS Simulator ZIP не подходит для установки и APNs-пушей на настоящий iPhone**.

1. В Apple Developer зарегистрируйте App ID `ru.digitalagronom.support` и включите Push Notifications.
2. Создайте APNs Auth Key (`.p8`), сохраните Key ID и Team ID. Для приложения на реальном iPhone настройте signing/provisioning в Xcode.
3. В Supabase Dashboard → Edge Functions → Secrets добавьте:
   - `APNS_PRIVATE_KEY` — текст P8 с BEGIN/END PRIVATE KEY и переводами строк.
   - `APNS_KEY_ID` — идентификатор Apple APNs Key.
   - `APNS_TEAM_ID` — Apple Developer Team ID.
   - `APNS_BUNDLE_ID` = `ru.digitalagronom.support`.
   - `APNS_ENVIRONMENT` = `development` для тестового приложения, подписанного development profile, или `production` для TestFlight/App Store.
4. Сборочный скрипт `mobile/scripts/configure-ios-push.mjs` настраивает AppDelegate и development APNs entitlement после генерации проекта; для реального распространения проверьте Push Notifications capability и подпись в Xcode.

## 3. Активировать серверную отправку по расписанию

Уже развернуты функции:
- `crm-push-device` — только с авторизованной сессией Supabase; привязывает один телефон к текущему пользователю, поддерживает отключение.
- `crm-send-push` — принимает только секретный заголовок `x-crm-push-secret`; обходит просрочки и доставляет через FCM (Android) / APNs (iOS).

**Нужно задать один и тот же случайный секрет (не короче 32 символов) в двух местах:**

1. Supabase Dashboard → Edge Functions → Secrets: `CRM_PUSH_CRON_SECRET` = ваш случайный секрет.
2. Supabase Dashboard → SQL Editor выполнить (не вставляйте секрет в GitHub или чат):
   ```sql
   select vault.create_secret('ВАШ_СЛУЧАЙНЫЙ_СЕКРЕТ_ОТ_32_СИМВОЛОВ','crm_push_cron_secret');
   ```

Ежедневный job `crm-push-overdue-daily` уже создан и активен. **Пока `crm_push_cron_secret` отсутствует в Vault, job просто пропускает запуск**. Адрес проекта сохранён в Vault отдельно.

Проверка наличия расписания (без раскрытия секретов):
```sql
select jobid, jobname, schedule, active
from cron.job
where jobname = 'crm-push-overdue-daily';
```

Для ручной проверки администратор может выполнить POST к `/functions/v1/crm-send-push` с заголовком `x-crm-push-secret` (тем же серверным секретом) и телом `{}`, например в Postman. Ответ содержит счётчики `checked`, `sent`, `skipped`, `failed`. Сервис не отправляет push для закрытых записей, отсутствующих подписок и уже уведомлённых в этот день.

## 4. Проверить регистрацию устройства и доставку

После установки **нового APK** (старая версия без плагина не поддерживает push):

1. Войдите под пользователем CRM, откройте **Ещё → Уведомления на телефон**.
2. Нажмите **Включить уведомления** и разрешите их в Android/iOS.
3. Убедитесь, что показан статус *«Телефон подключён. Уведомления включены»*. Если видите уведомление о необходимости ключей, завершите настройку Firebase/Apple и повторите регистрацию.
4. Проверить количество подписок из SQL Editor (не извлекая сами токены):
   ```sql
   select platform,count(*) from public.crm_push_devices where active group by platform;
   ```
5. При наступлении просрочки в 10:00 МСК push будет отправлен ответственным и администраторам. На Android push придёт и при закрытой CRM, если разрешён фоновой обмен данными и сервисы Google Play доступны; на iOS доставку осуществляет APNs.

Возможности доставки зависят от системных разрешений, связи, режима экономии энергии и доступности FCM/APNs.

## Безопасность

- `crm_push_devices` и `crm_push_delivery_log`: RLS включён; клиент не может читать токены других пользователей или журнал отправки.
- Управление регистрацией проверяет действительную сессию через `auth.getUser(token)`, не принимает `user_id` от клиента.
- `crm-send-push` **не доверяет публичному anon key или пользовательскому JWT**; нужен секретный заголовок и серверная среда.
- Ключи Firebase Admin / Apple P8 / CRM_PUSH_CRON_SECRET хранятся **в Supabase Secrets / Vault**, а не в GitHub, APK и браузере.
- Ошибочные/просроченные токены устройств могут быть отключены автоматически. История отправок ограничивает повторы одного push до одного в день.
