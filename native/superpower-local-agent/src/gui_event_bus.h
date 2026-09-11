#pragma once

#include <QJsonObject>
#include <QString>

QString superpowerGuiEventServerName();
bool publishGuiEvent(const QJsonObject& event, int timeoutMs = 80);
