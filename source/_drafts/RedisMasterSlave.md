---
title: Redis源码图解(23) Redis 主从模式
date: 2025-03-17 09:58:08
categories:
- Tech
tags:
- redis
---

# Redis主从模式

Redis多实例相关的内容从这一节开始记录, 首先是主从模式.

## 配置项

Redis配置文件中支持replicaof(或者slaveof)的配置项, 格式为:

```c
replicaof <masterip> <masterport>
```

此配置项仅在slave实例配置, 声明实例的master地址.



## ReplicationCron定时任务

Slave实例在启动后, 会作为一台正常的实例被拉起. 不同的是, 在进入server cron定时任务后, 会触发主从模式的定时任务replicationCron.
