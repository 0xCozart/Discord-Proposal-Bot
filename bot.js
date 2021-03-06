const Keyv = require('keyv');
const GrayBoyContract = require('./web3/web3.js');
const { database, clientId } = require('./config.json');
const { Embed, updateEmbedVotes } = require('./modules/embed.js');
const updateCommandPermissions = require('./commands/update-command-permissions.js');

class DaoApp {
  /**
   * @param {string} token - Discord application token
   * @param {ClientObject} client - Discord client
   * @param {string} channel - channel id
   */
  constructor(token, client, channel) {
    this.token = token;
    this.client = client;
    this.channel = channel;
    this.contract = new GrayBoyContract();
    this.db = new Keyv(`sqlite://${__dirname}/database/${database}.sqlite`);

    this.db.on('error', (err) => {
      console.error(err);
    });
  }

  /**
   * @dev interaction handler for bot slash commands
   * @param {InteractionObject} interaction
   */
  async interactionHandler(interaction) {
    const member = interaction.member;
    const { commandName, options, channel } = interaction;

    if (commandName === 'register') {
      // Checks if address has already been registered
      const submittedAddress = options.getString('address');
      const address = await this.db.get(member.user.id);
      const user = await this.db.get(submittedAddress);

      if (user === undefined && address === undefined) {
        const registeredUserToAddress = await this.db.set(
          member.user.id,
          submittedAddress
        );
        const registerAddressToUser = await this.db.set(
          submittedAddress,
          member.user.id
        );
        registerAddressToUser && registeredUserToAddress
          ? await interaction.reply({
              content: `You have sucessfully registered: ${submittedAddress}`,
              ephemeral: true,
            })
          : await interaction.reply({
              content: 'Something went wrong, please try again.',
              ephemeral: true,
            });
        {
        }
      } else if (address) {
        await interaction.reply({
          content: `You have already registered this address: ${address} \nIf you would like to change your address, please contact an admin.`,
          ephemeral: true,
        });
      } else if (user !== member.user.id && user !== undefined) {
        return await interaction.reply({
          content: `This address has already been registered to another user. \nIf there is an issue, please contact an admin.`,
          ephemeral: true,
        });
      }
    } else if (commandName === 'proposal') {
      const reactions = options.getString('reactions');
      const reactionList = reactions.toString().split(',');
      const proposal = new Embed(
        options.getString('title'),
        options.getString('description'),
        reactionList,
        interaction.member.displayName
      );
      const embeddedProposal = proposal.message;
      const message = await channel.send({
        embeds: [embeddedProposal],
      });

      console.log({ message });
      // Adds the reactions given from the command to the message
      reactionList.forEach((reaction) => {
        message.react(reaction);
      });

      const getUsersReactions = (userId) => {
        return message.reactions.cache.filter((reaction) =>
          reaction.users.cache.has(userId)
        );
      };

      // Filter to only listen for voting options
      const filter = (reaction, user) => {
        return (
          reactionList.includes(reaction.emoji.name) &&
          message.reactions.cache.filter((reaction) =>
            reaction.users.cache.has(user.id)
          ).size <= 1
        );
      };
      const collector = message.createReactionCollector({ filter });
      // Events for reactions to message
      collector.on('collect', async (reaction, user, collection) => {
        const usersAddress = await this.db.get(user.id);
        if (user.id === clientId) return;
        let usersReacts = getUsersReactions(user.id);
        const balance = await this.contract
          .balanceOf(usersAddress)
          .catch((error) =>
            console.error(`User ${user.id} balance error: ${error}`)
          );
        const usersBalance = balance ? balance : 0;

        // If user does not have a registered address, they cannot vote
        if (usersAddress === undefined || usersBalance === 0) {
          reaction.users.remove(user.id);
          return;
        }

        const usersLastReaction = await this.db.get(
          `${user.id}_lastReactionOnMessage_${message.id}`
        );

        // first time user reacts to message
        if (usersLastReaction === undefined) {
          await this.db.set(`${user.id}_lastReactionOnMessage_${message.id}`, {
            reaction: reaction.emoji.name,
          });

          const newEmbed = updateEmbedVotes(
            message.embeds[0],
            reaction.emoji.name,
            usersBalance,
            'add'
          );

          message.edit({ embeds: [newEmbed] });
          // user has already reacted to message, but not to the same reaction
          // updates the embed with the current reaction
        } else if (usersLastReaction.reaction !== reaction.emoji.name) {
          usersReacts.each((react, key, collection) => {
            if (usersLastReaction.reaction === key) {
              react.users.remove(user.id);

              const cachedEmbed = updateEmbedVotes(
                message.embeds[0],
                key,
                usersBalance,
                'remove'
              );
              console.log({ cachedEmbed: cachedEmbed.fields });

              const newEmbed = updateEmbedVotes(
                cachedEmbed,
                reaction.emoji.name,
                usersBalance,
                'add'
              );

              message.edit({ embeds: [newEmbed] });
            } else if (
              // If user has voted => unvoted => voted on a different reaction
              usersLastReaction.reaction !== key &&
              usersReacts.size === 1
            ) {
              const cachedEmbed = updateEmbedVotes(
                message.embeds[0],
                usersLastReaction.reaction,
                usersBalance,
                'remove'
              );

              const newEmbed = updateEmbedVotes(
                cachedEmbed,
                key,
                usersBalance,
                'add'
              );

              message.edit({ embeds: [newEmbed] });
            }
          });

          await this.db.set(`${user.id}_lastReactionOnMessage_${message.id}`, {
            reaction: reaction.emoji.name,
          });
        }
      });

      await interaction.reply('Proposal sent!');
    } else if (commandName === 'unregister') {
      const usersInfo = options.getString('address')
        ? options.getString('address')
        : options.getString('user');

      try {
        const value = await this.db.get(usersInfo);
        await this.db.delete(usersInfo);
        await this.db.delete(value);
        await interaction.reply({
          content: `${usersInfo} has been unregistered.`,
          ephemeral: true,
        });
      } catch (error) {
        console.error(error);
      }
    } else if ((commandName === 'get-address') | (commandName === 'get-user')) {
      const submittedUserId = options.getString('user');
      const submittedAddress = options.getString('address');

      if (submittedUserId !== null) {
        const address = await this.db.get(submittedUserId);
        return await interaction.reply({
          content: address
            ? `${submittedUserId}'s address is: ${address}`
            : `${submittedUserId} has not registered an address.`,
          ephemeral: true,
        });
      }

      if (submittedAddress !== null) {
        const userId = await this.db.get(submittedAddress);
        return await interaction.reply({
          content: userId
            ? `${submittedAddress} is registered to: ${userId}`
            : `${submittedAddress} is not registered.`,
          ephemeral: true,
        });
      }
    } else {
      return await interaction.reply({
        content:
          'Sorry, something went wrong, or you do not have access to these commands.',
        ephemeral: true,
      });
    }
  }

  async start() {
    try {
      await this.client.once('ready', async () => {
        await updateCommandPermissions(this.client);
        console.log('Ready!');
      });

      this.client.on('interactionCreate', async (interaction) => {
        if (!interaction.isCommand()) return;

        await this.interactionHandler(interaction);
      });

      // starts the application client
      await this.client.login(this.token);
    } catch (e) {
      console.error(e);
    }
  }
}

module.exports = DaoApp;
